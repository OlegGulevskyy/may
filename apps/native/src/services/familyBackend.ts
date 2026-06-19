import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  runTransaction,
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore,
  type Unsubscribe,
} from "firebase/firestore";
import {
  getDownloadURL,
  ref,
  uploadBytes,
  type FirebaseStorage,
} from "firebase/storage";

import {
  createFamily,
  createFamilyMember,
  GOOGLE_DELIVERY_SCOPES,
  normalizeInviteCode,
  type Family,
  type FamilyInvite,
  type FamilyMember,
  type GoogleDeliveryConnection,
  type LocalProfile,
} from "@may/core";

import { getFirebaseServices } from "./firebase";

type CreateFamilyInput = {
  yourName: string;
  childName: string;
  childEmail: string;
};

export type ProfilePhotoInput = {
  fileName?: string | null;
  mimeType?: string | null;
  uri: string;
};

type FamilySession = {
  activeMemberId: string;
  family: Family;
  familyMemberships: UserFamilyMembership[];
  profile: LocalProfile;
};

export type UserFamilyMembership = {
  familyId: string;
  childEmail?: string;
  childName: string;
  joinedAt: string;
  memberId: string;
  role: FamilyMember["role"];
  updatedAt: string;
};

type UserFamilyProfile = {
  activeFamilyId?: string;
  displayName?: string;
  email?: string | null;
  id?: string;
  photoURL?: string | null;
};

type InviteLookup = {
  code: string;
  familyId: string;
  childName: string;
  label: string;
  status: FamilyInvite["status"];
  createdBy: string;
  createdAt: string;
  acceptedAt?: string;
  acceptedBy?: string;
};

type RemoteFamilyBase = Pick<
  Family,
  | "id"
  | "childName"
  | "childEmail"
  | "deliveryCcEmails"
  | "createdAt"
  | "deliveryConnection"
>;

const inviteLookupCollection = "inviteCodes";

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong.";

const warnFamilyMembershipWriteFailed = (error: unknown) =>
  console.warn("[MaySync] family membership write failed", {
    error: getErrorMessage(error),
  });

const requireSignedIn = () => {
  const services = getFirebaseServices();
  if (!services) {
    throw new Error("Firebase is not configured.");
  }

  const user = services.auth.currentUser;
  if (!user) {
    throw new Error("Sign in before continuing.");
  }

  return { services, user };
};

const toLocalProfile = (member: FamilyMember): LocalProfile => ({
  id: member.id,
  displayName: member.displayName,
  initials: member.initials,
  photoURL: member.photoURL,
});

const userFamilyMembershipRef = (
  db: Firestore,
  userId: string,
  familyId: string,
) => doc(db, "users", userId, "families", familyId);

const familyMembershipFromFamily = ({
  family,
  member,
  updatedAt = new Date().toISOString(),
}: {
  family: Family;
  member: FamilyMember;
  updatedAt?: string;
}): UserFamilyMembership => ({
  childEmail: family.childEmail,
  childName: family.childName,
  familyId: family.id,
  joinedAt: member.joinedAt,
  memberId: member.id,
  role: member.role,
  updatedAt,
});

const familyMembershipFromValue = (
  id: string,
  value: Record<string, unknown>,
): UserFamilyMembership | null => {
  const familyId = typeof value.familyId === "string" ? value.familyId : id;
  const childName =
    typeof value.childName === "string" && value.childName.trim()
      ? value.childName
      : "Family wall";
  const memberId = typeof value.memberId === "string" ? value.memberId : "";

  if (!familyId || !memberId) {
    return null;
  }

  return {
    childEmail:
      typeof value.childEmail === "string" ? value.childEmail : undefined,
    childName,
    familyId,
    joinedAt:
      typeof value.joinedAt === "string"
        ? value.joinedAt
        : new Date().toISOString(),
    memberId,
    role: value.role === "creator" ? "creator" : "partner",
    updatedAt:
      typeof value.updatedAt === "string"
        ? value.updatedAt
        : new Date().toISOString(),
  };
};

const sortFamilyMemberships = (memberships: UserFamilyMembership[]) =>
  [...memberships].sort((first, second) =>
    first.joinedAt.localeCompare(second.joinedAt),
  );

const mergeFamilyMemberships = (memberships: UserFamilyMembership[]) => {
  const byFamilyId = new Map<string, UserFamilyMembership>();
  for (const membership of memberships) {
    byFamilyId.set(membership.familyId, {
      ...byFamilyId.get(membership.familyId),
      ...membership,
    });
  }

  return sortFamilyMemberships([...byFamilyId.values()]);
};

const fetchUserFamilyMemberships = async (): Promise<
  UserFamilyMembership[]
> => {
  const signedIn = requireSignedIn();
  const membershipsSnap = await getDocs(
    collection(signedIn.services.db, "users", signedIn.user.uid, "families"),
  );

  return sortFamilyMemberships(
    membershipsSnap.docs
      .map((membership) =>
        familyMembershipFromValue(membership.id, membership.data()),
      )
      .filter((membership): membership is UserFamilyMembership =>
        Boolean(membership),
      ),
  );
};

const googleDeliveryScopeSet = new Set<string>(GOOGLE_DELIVERY_SCOPES);

const googleDeliveryConnectionFromValue = (
  value: unknown,
): GoogleDeliveryConnection | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const data = value as Record<string, unknown>;
  const scopes = Array.isArray(data.scopes)
    ? data.scopes.filter(
        (scope): scope is GoogleDeliveryConnection["scopes"][number] =>
          typeof scope === "string" && googleDeliveryScopeSet.has(scope),
      )
    : [];

  if (
    typeof data.googleEmail !== "string" ||
    typeof data.connectedBy !== "string" ||
    typeof data.connectedAt !== "string" ||
    typeof data.updatedAt !== "string"
  ) {
    return undefined;
  }

  return {
    status: data.status === "needs_reconnect" ? data.status : "connected",
    googleEmail: data.googleEmail,
    scopes,
    connectedBy: data.connectedBy,
    connectedAt: data.connectedAt,
    updatedAt: data.updatedAt,
  };
};

const deliveryCcEmailsFromValue = (data: Record<string, unknown>) => {
  const values = [
    ...(Array.isArray(data.deliveryCcEmails) ? data.deliveryCcEmails : []),
    data.deliveryCcEmail,
  ];
  const seen = new Set<string>();

  return values
    .filter((value): value is string => typeof value === "string")
    .map((email) => email.trim())
    .filter(Boolean)
    .filter((email) => {
      const key = email.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
};

const blobFromLocalUri = (uri: string): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.responseType = "blob";
    xhr.onload = () => resolve(xhr.response as Blob);
    xhr.onerror = () => reject(new Error("Failed to read profile photo."));
    xhr.open("GET", uri, true);
    xhr.send(null);
  });

const fileExtension = (value?: string | null) =>
  value?.split("?")[0]?.split(".").pop()?.toLowerCase();

const profilePhotoContentType = (photo: ProfilePhotoInput) => {
  if (photo.mimeType?.startsWith("image/")) {
    return photo.mimeType;
  }

  switch (fileExtension(photo.fileName) ?? fileExtension(photo.uri)) {
    case "png":
      return "image/png";
    case "heic":
      return "image/heic";
    case "heif":
      return "image/heif";
    case "webp":
      return "image/webp";
    case "jpg":
    case "jpeg":
    default:
      return "image/jpeg";
  }
};

const profilePhotoExtension = (contentType: string) => {
  switch (contentType.toLowerCase()) {
    case "image/png":
      return "png";
    case "image/heic":
      return "heic";
    case "image/heif":
      return "heif";
    case "image/webp":
      return "webp";
    default:
      return "jpg";
  }
};

const profilePhotoStoragePath = ({
  contentType,
  familyId,
  memberId,
}: {
  contentType: string;
  familyId: string;
  memberId: string;
}) =>
  `families/${familyId}/members/${memberId}/profile-photo/avatar.${profilePhotoExtension(contentType)}`;

const uploadProfilePhoto = async ({
  familyId,
  memberId,
  photo,
  storage,
}: {
  familyId: string;
  memberId: string;
  photo: ProfilePhotoInput;
  storage: FirebaseStorage;
}) => {
  const contentType = profilePhotoContentType(photo);
  const storagePath = profilePhotoStoragePath({
    contentType,
    familyId,
    memberId,
  });
  const storageRef = ref(storage, storagePath);
  const blob = await blobFromLocalUri(photo.uri);

  try {
    await uploadBytes(storageRef, blob, { contentType });
  } finally {
    (blob as Blob & { close?: () => void }).close?.();
  }

  return {
    photoStoragePath: storagePath,
    photoURL: await getDownloadURL(storageRef),
  };
};

const familyBaseFromSnapshot = (
  id: string,
  data: Record<string, unknown>,
): RemoteFamilyBase => ({
  id,
  childName: String(data.childName ?? ""),
  childEmail: String(data.childEmail ?? ""),
  deliveryCcEmails: deliveryCcEmailsFromValue(data),
  createdAt:
    typeof data.createdAt === "string"
      ? data.createdAt
      : new Date().toISOString(),
  deliveryConnection: googleDeliveryConnectionFromValue(
    data.deliveryConnection,
  ),
});

const sortByCreatedAt = <T extends { createdAt?: string; joinedAt?: string }>(
  items: T[],
) =>
  [...items].sort((first, second) =>
    String(first.joinedAt ?? first.createdAt ?? "").localeCompare(
      String(second.joinedAt ?? second.createdAt ?? ""),
    ),
  );

const membersWithLegacyDeliveryConnection = ({
  legacyDeliveryConnection,
  members,
}: {
  legacyDeliveryConnection?: GoogleDeliveryConnection;
  members: FamilyMember[];
}) => {
  if (!legacyDeliveryConnection) {
    return members;
  }

  return members.map((member) =>
    member.id === legacyDeliveryConnection.connectedBy &&
    !member.deliveryConnection
      ? {
          ...member,
          deliveryConnection: legacyDeliveryConnection,
        }
      : member,
  );
};

const familyFromParts = ({
  base,
  invites,
  members,
}: {
  base: RemoteFamilyBase;
  invites: FamilyInvite[];
  members: FamilyMember[];
}): Family => ({
  ...base,
  invites: sortByCreatedAt(invites),
  members: sortByCreatedAt(
    membersWithLegacyDeliveryConnection({
      legacyDeliveryConnection: base.deliveryConnection,
      members,
    }),
  ),
});

export const createRemoteProfileAndFamily = async ({
  yourName,
  childName,
  childEmail,
}: CreateFamilyInput): Promise<FamilySession | null> => {
  const signedIn = requireSignedIn();

  const creator = createFamilyMember({
    displayName: yourName,
    id: signedIn.user.uid,
    role: "creator",
  });
  const family = createFamily({ childName, childEmail, creator });

  const familyRef = doc(signedIn.services.db, "families", family.id);
  const memberRef = doc(familyRef, "members", creator.id);
  const userRef = doc(signedIn.services.db, "users", signedIn.user.uid);
  const userFamilyRef = userFamilyMembershipRef(
    signedIn.services.db,
    signedIn.user.uid,
    family.id,
  );
  const batch = writeBatch(signedIn.services.db);
  const membership = familyMembershipFromFamily({
    family,
    member: creator,
    updatedAt: family.createdAt,
  });

  batch.set(familyRef, {
    childEmail: family.childEmail,
    childName: family.childName,
    createdAt: family.createdAt,
    createdBy: creator.id,
    id: family.id,
    schemaVersion: 1,
    updatedAt: family.createdAt,
  });
  batch.set(memberRef, creator);
  batch.set(
    userRef,
    {
      activeFamilyId: family.id,
      displayName: creator.displayName,
      email: signedIn.user.email,
      id: signedIn.user.uid,
      photoURL: signedIn.user.photoURL,
      updatedAt: family.createdAt,
    },
    { merge: true },
  );
  batch.set(userFamilyRef, membership, { merge: true });

  await batch.commit();

  return {
    activeMemberId: creator.id,
    family,
    familyMemberships: [membership],
    profile: toLocalProfile(creator),
  };
};

export const createRemoteInvite = async ({
  family,
  invite,
}: {
  family: Family;
  invite: FamilyInvite;
}): Promise<boolean> => {
  const signedIn = requireSignedIn();

  const inviteRef = doc(
    signedIn.services.db,
    "families",
    family.id,
    "invites",
    invite.code,
  );
  const lookupRef = doc(
    signedIn.services.db,
    inviteLookupCollection,
    invite.code,
  );
  const batch = writeBatch(signedIn.services.db);
  const lookup: InviteLookup = {
    code: invite.code,
    familyId: family.id,
    childName: family.childName,
    label: invite.label,
    status: invite.status,
    createdBy: invite.createdBy,
    createdAt: invite.createdAt,
  };

  batch.set(inviteRef, { ...invite, familyId: family.id });
  batch.set(lookupRef, lookup);
  await batch.commit();

  return true;
};

export const joinRemoteFamilyWithCode = async ({
  yourName,
  code,
}: {
  yourName: string;
  code: string;
}): Promise<FamilySession | null> => {
  const signedIn = requireSignedIn();

  const normalizedCode = normalizeInviteCode(code);
  const lookupRef = doc(
    signedIn.services.db,
    inviteLookupCollection,
    normalizedCode,
  );
  const member = createFamilyMember({
    displayName: yourName,
    id: signedIn.user.uid,
    role: "partner",
  });

  let familyId: string | null = null;
  let sessionMember = member;

  await runTransaction(signedIn.services.db, async (transaction) => {
    const lookupSnap = await transaction.get(lookupRef);
    if (!lookupSnap.exists()) {
      return;
    }

    const lookup = lookupSnap.data() as InviteLookup;
    const memberRef = doc(
      signedIn.services.db,
      "families",
      lookup.familyId,
      "members",
      member.id,
    );
    const existingMemberSnap = await transaction.get(memberRef);
    const existingMember = existingMemberSnap.exists()
      ? (existingMemberSnap.data() as FamilyMember)
      : null;

    if (lookup.status !== "pending" && !existingMember) {
      return;
    }

    familyId = lookup.familyId;
    const acceptedAt = new Date().toISOString();
    sessionMember = existingMember ?? member;
    const userRef = doc(signedIn.services.db, "users", signedIn.user.uid);
    const userFamilyRef = userFamilyMembershipRef(
      signedIn.services.db,
      signedIn.user.uid,
      lookup.familyId,
    );
    const inviteRef = doc(
      signedIn.services.db,
      "families",
      lookup.familyId,
      "invites",
      normalizedCode,
    );

    if (!existingMember) {
      transaction.set(memberRef, member);
      transaction.update(inviteRef, {
        acceptedAt,
        acceptedBy: member.id,
        status: "accepted",
      });
      transaction.update(lookupRef, {
        acceptedAt,
        acceptedBy: member.id,
        status: "accepted",
      });
    }

    transaction.set(
      userRef,
      {
        activeFamilyId: lookup.familyId,
        displayName: sessionMember.displayName,
        email: signedIn.user.email,
        id: signedIn.user.uid,
        photoURL: signedIn.user.photoURL,
        updatedAt: acceptedAt,
      },
      { merge: true },
    );
    transaction.set(
      userFamilyRef,
      {
        childName: lookup.childName,
        familyId: lookup.familyId,
        joinedAt: sessionMember.joinedAt,
        memberId: sessionMember.id,
        role: sessionMember.role,
        updatedAt: acceptedAt,
      } satisfies UserFamilyMembership,
      { merge: true },
    );
  });

  if (!familyId) {
    return null;
  }

  const family = await fetchRemoteFamily(familyId);
  const familyMember =
    family.members.find((current) => current.id === signedIn.user.uid) ??
    sessionMember;
  const membership = familyMembershipFromFamily({
    family,
    member: familyMember,
  });
  const memberships = mergeFamilyMemberships([
    ...(await fetchUserFamilyMemberships()),
    membership,
  ]);

  await setDoc(
    userFamilyMembershipRef(signedIn.services.db, signedIn.user.uid, family.id),
    membership,
    {
      merge: true,
    },
  ).catch(warnFamilyMembershipWriteFailed);

  return {
    activeMemberId: familyMember.id,
    family,
    familyMemberships: memberships,
    profile: toLocalProfile(familyMember),
  };
};

export const fetchRemoteFamily = async (familyId: string): Promise<Family> => {
  const signedIn = requireSignedIn();

  const familyRef = doc(signedIn.services.db, "families", familyId);
  const familySnap = await getDoc(familyRef);
  if (!familySnap.exists()) {
    throw new Error("Family was not found in Firebase.");
  }

  const membersSnap = await getDocs(collection(familyRef, "members"));
  const invitesSnap = await getDocs(collection(familyRef, "invites"));
  const base = familyBaseFromSnapshot(familySnap.id, familySnap.data());

  return familyFromParts({
    base,
    invites: invitesSnap.docs.map((invite) => invite.data() as FamilyInvite),
    members: membersSnap.docs.map((member) => member.data() as FamilyMember),
  });
};

export const loadRemoteSessionForCurrentUser =
  async (): Promise<FamilySession | null> => {
    const signedIn = requireSignedIn();
    const userRef = doc(signedIn.services.db, "users", signedIn.user.uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      return null;
    }

    const userProfile = userSnap.data() as UserFamilyProfile;
    if (!userProfile.activeFamilyId) {
      return null;
    }

    const family = await fetchRemoteFamily(userProfile.activeFamilyId);
    const member = family.members.find(
      (current) => current.id === signedIn.user.uid,
    );
    const fallbackProfile = {
      id: signedIn.user.uid,
      displayName:
        userProfile.displayName ?? signedIn.user.displayName ?? "Parent",
      initials:
        (userProfile.displayName ?? signedIn.user.displayName ?? "Parent")
          .slice(0, 1)
          .toUpperCase() || "?",
    };
    const activeMembership = member
      ? familyMembershipFromFamily({ family, member })
      : null;

    if (activeMembership) {
      await setDoc(
        userFamilyMembershipRef(
          signedIn.services.db,
          signedIn.user.uid,
          family.id,
        ),
        activeMembership,
        { merge: true },
      ).catch(warnFamilyMembershipWriteFailed);
    }

    const familyMemberships = mergeFamilyMemberships([
      ...(await fetchUserFamilyMemberships()),
      ...(activeMembership ? [activeMembership] : []),
    ]);

    return {
      activeMemberId: signedIn.user.uid,
      family,
      familyMemberships,
      profile: member ? toLocalProfile(member) : fallbackProfile,
    };
  };

export const switchRemoteFamily = async (
  familyId: string,
): Promise<FamilySession> => {
  const signedIn = requireSignedIn();
  const family = await fetchRemoteFamily(familyId);
  const member = family.members.find(
    (current) => current.id === signedIn.user.uid,
  );

  if (!member) {
    throw new Error("You are not a member of that wall.");
  }

  const updatedAt = new Date().toISOString();
  const membership = familyMembershipFromFamily({ family, member, updatedAt });
  const userRef = doc(signedIn.services.db, "users", signedIn.user.uid);
  const userFamilyRef = userFamilyMembershipRef(
    signedIn.services.db,
    signedIn.user.uid,
    family.id,
  );
  const batch = writeBatch(signedIn.services.db);

  batch.set(
    userRef,
    {
      activeFamilyId: family.id,
      displayName: member.displayName,
      email: signedIn.user.email,
      id: signedIn.user.uid,
      photoURL: signedIn.user.photoURL,
      updatedAt,
    },
    { merge: true },
  );
  batch.set(userFamilyRef, membership, { merge: true });
  await batch.commit();

  return {
    activeMemberId: member.id,
    family,
    familyMemberships: mergeFamilyMemberships([
      ...(await fetchUserFamilyMemberships()),
      membership,
    ]),
    profile: toLocalProfile(member),
  };
};

export const updateRemoteFamilyDeliveryCcEmails = async ({
  familyId,
  ccEmails,
}: {
  familyId: string;
  ccEmails: string[];
}) => {
  const signedIn = requireSignedIn();
  const normalizedCcEmails = deliveryCcEmailsFromValue({
    deliveryCcEmails: ccEmails,
  });

  await updateDoc(doc(signedIn.services.db, "families", familyId), {
    deliveryCcEmail: deleteField(),
    deliveryCcEmails:
      normalizedCcEmails.length > 0 ? normalizedCcEmails : deleteField(),
    updatedAt: new Date().toISOString(),
  });
};

export const updateRemoteMemberProfilePhoto = async ({
  familyId,
  memberId,
  photo,
}: {
  familyId: string;
  memberId: string;
  photo: ProfilePhotoInput;
}) => {
  const signedIn = requireSignedIn();
  if (signedIn.user.uid !== memberId) {
    throw new Error("You can only update your own profile picture.");
  }

  const uploadedPhoto = await uploadProfilePhoto({
    familyId,
    memberId,
    photo,
    storage: signedIn.services.storage,
  });
  const updatedAt = new Date().toISOString();

  await Promise.all([
    updateDoc(
      doc(signedIn.services.db, "families", familyId, "members", memberId),
      {
        ...uploadedPhoto,
        updatedAt,
      },
    ),
    setDoc(
      doc(signedIn.services.db, "users", signedIn.user.uid),
      {
        photoURL: uploadedPhoto.photoURL,
        updatedAt,
      },
      { merge: true },
    ),
  ]);

  return uploadedPhoto;
};

export const subscribeToRemoteFamily = async ({
  familyId,
  onError,
  onFamily,
}: {
  familyId: string;
  onError: (message: string) => void;
  onFamily: (family: Family) => void;
}): Promise<Unsubscribe> => {
  const signedIn = requireSignedIn();

  const familyRef = doc(signedIn.services.db, "families", familyId);
  let base: RemoteFamilyBase | null = null;
  let members: FamilyMember[] = [];
  let invites: FamilyInvite[] = [];
  let baseReady = false;
  let membersReady = false;
  let invitesReady = false;

  const emit = () => {
    if (!base || !baseReady || !membersReady || !invitesReady) {
      return;
    }
    onFamily(familyFromParts({ base, invites, members }));
  };

  const handleError = (error: unknown) => onError(getErrorMessage(error));

  const unsubscribeFamily = onSnapshot(
    familyRef,
    (snapshot) => {
      baseReady = true;
      if (!snapshot.exists()) {
        return;
      }
      base = familyBaseFromSnapshot(snapshot.id, snapshot.data());
      emit();
    },
    handleError,
  );
  const unsubscribeMembers = onSnapshot(
    collection(familyRef, "members"),
    (snapshot) => {
      membersReady = true;
      members = snapshot.docs.map((member) => member.data() as FamilyMember);
      emit();
    },
    handleError,
  );
  const unsubscribeInvites = onSnapshot(
    collection(familyRef, "invites"),
    (snapshot) => {
      invitesReady = true;
      invites = snapshot.docs.map((invite) => invite.data() as FamilyInvite);
      emit();
    },
    handleError,
  );

  return () => {
    unsubscribeFamily();
    unsubscribeMembers();
    unsubscribeInvites();
  };
};
