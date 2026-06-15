import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  runTransaction,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";

import {
  createFamily,
  createFamilyMember,
  normalizeInviteCode,
  type Family,
  type FamilyInvite,
  type FamilyMember,
  type LocalProfile,
} from "@may/core";

import { getFirebaseServices } from "./firebase";

type CreateFamilyInput = {
  yourName: string;
  childName: string;
  childEmail: string;
};

type FamilySession = {
  activeMemberId: string;
  family: Family;
  profile: LocalProfile;
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
  "id" | "childName" | "childEmail" | "createdAt"
>;

const inviteLookupCollection = "inviteCodes";

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong.";

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
});

const familyBaseFromSnapshot = (
  id: string,
  data: Record<string, unknown>,
): RemoteFamilyBase => ({
  id,
  childName: String(data.childName ?? ""),
  childEmail: String(data.childEmail ?? ""),
  createdAt:
    typeof data.createdAt === "string"
      ? data.createdAt
      : new Date().toISOString(),
});

const sortByCreatedAt = <T extends { createdAt?: string; joinedAt?: string }>(
  items: T[],
) =>
  [...items].sort((first, second) =>
    String(first.joinedAt ?? first.createdAt ?? "").localeCompare(
      String(second.joinedAt ?? second.createdAt ?? ""),
    ),
  );

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
  const batch = writeBatch(signedIn.services.db);

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

  await batch.commit();

  return {
    activeMemberId: creator.id,
    family,
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

  await runTransaction(signedIn.services.db, async (transaction) => {
    const lookupSnap = await transaction.get(lookupRef);
    if (!lookupSnap.exists()) {
      return;
    }

    const lookup = lookupSnap.data() as InviteLookup;
    if (lookup.status !== "pending") {
      return;
    }

    familyId = lookup.familyId;
    const acceptedAt = new Date().toISOString();
    const memberRef = doc(
      signedIn.services.db,
      "families",
      lookup.familyId,
      "members",
      member.id,
    );
    const userRef = doc(signedIn.services.db, "users", signedIn.user.uid);
    const inviteRef = doc(
      signedIn.services.db,
      "families",
      lookup.familyId,
      "invites",
      normalizedCode,
    );

    transaction.set(memberRef, member);
    transaction.set(
      userRef,
      {
        activeFamilyId: lookup.familyId,
        displayName: member.displayName,
        email: signedIn.user.email,
        id: signedIn.user.uid,
        photoURL: signedIn.user.photoURL,
        updatedAt: acceptedAt,
      },
      { merge: true },
    );
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
  });

  if (!familyId) {
    return null;
  }

  const family = await fetchRemoteFamily(familyId);
  return {
    activeMemberId: member.id,
    family,
    profile: toLocalProfile(member),
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

  return {
    ...base,
    invites: sortByCreatedAt(
      invitesSnap.docs.map((invite) => invite.data() as FamilyInvite),
    ),
    members: sortByCreatedAt(
      membersSnap.docs.map((member) => member.data() as FamilyMember),
    ),
  };
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

    return {
      activeMemberId: signedIn.user.uid,
      family,
      profile: member
        ? toLocalProfile(member)
        : {
            id: signedIn.user.uid,
            displayName:
              userProfile.displayName ?? signedIn.user.displayName ?? "Parent",
            initials:
              (userProfile.displayName ?? signedIn.user.displayName ?? "Parent")
                .slice(0, 1)
                .toUpperCase() || "?",
          },
    };
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
    onFamily({
      ...base,
      invites: sortByCreatedAt(invites),
      members: sortByCreatedAt(members),
    });
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
