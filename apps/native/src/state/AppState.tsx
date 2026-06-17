import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  createInvite,
  resolveMember,
  type Family,
  type FamilyInvite,
  type FamilyMember,
  type LocalProfile,
} from "@may/core";

import {
  createRemoteInvite,
  createRemoteProfileAndFamily,
  fetchRemoteFamily,
  joinRemoteFamilyWithCode,
  loadRemoteSessionForCurrentUser,
  subscribeToRemoteFamily,
  switchRemoteFamily,
  updateRemoteFamilyDeliveryCcEmails,
  type UserFamilyMembership,
} from "../services/familyBackend";
import {
  signInWithGoogle as signInWithGoogleRemote,
  signOutCurrentUser,
  subscribeToAuthUser,
  type AuthUser,
} from "../services/authBackend";
import {
  getLocalString,
  removeLocalItem,
  setLocalString,
} from "../services/storage";
import { connectGoogleDelivery as connectGoogleDeliveryRemote } from "../services/googleDeliveryBackend";

const PROFILE_KEY = "may.profile.v1";
const FAMILY_KEY = "may.family.v1";
const FAMILY_MEMBERSHIPS_KEY = "may.family-memberships.v1";
const ACTIVE_MEMBER_KEY = "may.active-member.v1";
export const wallStorageKey = (familyId: string) =>
  `may.memory-wall.${familyId}.v1`;

const googleDeliveryPollIntervalsMs = [
  1_500, 2_000, 2_500, 3_000, 4_000, 5_000,
];

type CreateFamilyInput = {
  yourName: string;
  childName: string;
  childEmail: string;
};

type AuthStatus = "loading" | "signed-out" | "signed-in";

export type FamilyMembership = UserFamilyMembership;

type AppStateValue = {
  authStatus: AuthStatus;
  authUser: AuthUser | null;
  hydrated: boolean;
  isRestoringSession: boolean;
  profile: LocalProfile | null;
  family: Family | null;
  familyMemberships: FamilyMembership[];
  /** The member currently composing/reacting on this device. */
  activeMemberId: string | null;
  activeMember: FamilyMember | null;
  isReady: boolean;
  syncError: string | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  createProfileAndFamily: (input: CreateFamilyInput) => Promise<void>;
  addInvite: (label: string) => Promise<FamilyInvite>;
  connectGoogleDelivery: () => Promise<void>;
  joinWithCode: (input: { yourName: string; code: string }) => Promise<boolean>;
  updateDeliveryCcEmails: (ccEmails: string[]) => Promise<void>;
  setActiveMemberId: (memberId: string) => void;
  switchFamily: (familyId: string) => Promise<void>;
  reset: () => void;
};

const AppStateContext = createContext<AppStateValue | null>(null);

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong.";

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const sortFamilyMemberships = (memberships: FamilyMembership[]) =>
  [...memberships].sort((first, second) =>
    first.joinedAt.localeCompare(second.joinedAt),
  );

const normalizeEmailList = (emails: string[]) => {
  const seen = new Set<string>();

  return emails
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

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [isRestoringSession, setIsRestoringSession] = useState(false);
  const [profile, setProfile] = useState<LocalProfile | null>(null);
  const [family, setFamily] = useState<Family | null>(null);
  const [familyMemberships, setFamilyMemberships] = useState<
    FamilyMembership[]
  >([]);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [activeMemberId, setActiveMemberIdState] = useState<string | null>(
    null,
  );

  useEffect(() => {
    try {
      const storedProfile = getLocalString(PROFILE_KEY);
      const storedFamily = getLocalString(FAMILY_KEY);
      const storedFamilyMemberships = getLocalString(FAMILY_MEMBERSHIPS_KEY);
      const storedActive = getLocalString(ACTIVE_MEMBER_KEY);
      if (storedProfile) {
        setProfile(JSON.parse(storedProfile) as LocalProfile);
      }
      if (storedFamily) {
        setFamily(JSON.parse(storedFamily) as Family);
      }
      if (storedFamilyMemberships) {
        setFamilyMemberships(
          JSON.parse(storedFamilyMemberships) as FamilyMembership[],
        );
      }
      if (storedActive) {
        setActiveMemberIdState(storedActive);
      }
      setHydrated(true);
    } catch {
      setHydrated(true);
    }
  }, []);

  useEffect(
    () =>
      subscribeToAuthUser({
        onError: setSyncError,
        onUser: (user) => {
          if (!user) {
            setAuthUser(null);
            setAuthStatus("signed-out");
            setIsRestoringSession(false);
            setProfile(null);
            setFamily(null);
            setFamilyMemberships([]);
            setActiveMemberIdState(null);
            return;
          }

          setAuthUser(user);
          setAuthStatus("signed-in");
          setIsRestoringSession(true);
          loadRemoteSessionForCurrentUser()
            .then((remoteSession) => {
              if (!remoteSession) {
                setProfile(null);
                setFamily(null);
                setFamilyMemberships([]);
                setActiveMemberIdState(null);
                return;
              }

              setSyncError(null);
              setProfile(remoteSession.profile);
              setFamily(remoteSession.family);
              setFamilyMemberships(remoteSession.familyMemberships);
              setActiveMemberIdState(remoteSession.activeMemberId);
            })
            .catch((error) => setSyncError(getErrorMessage(error)))
            .finally(() => setIsRestoringSession(false));
        },
      }),
    [],
  );

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    if (profile) {
      setLocalString(PROFILE_KEY, JSON.stringify(profile));
    } else {
      removeLocalItem(PROFILE_KEY);
    }
  }, [hydrated, profile]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    if (family) {
      setLocalString(FAMILY_KEY, JSON.stringify(family));
    } else {
      removeLocalItem(FAMILY_KEY);
    }
  }, [hydrated, family]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    if (familyMemberships.length > 0) {
      setLocalString(FAMILY_MEMBERSHIPS_KEY, JSON.stringify(familyMemberships));
    } else {
      removeLocalItem(FAMILY_MEMBERSHIPS_KEY);
    }
  }, [familyMemberships, hydrated]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    if (activeMemberId) {
      setLocalString(ACTIVE_MEMBER_KEY, activeMemberId);
    } else {
      removeLocalItem(ACTIVE_MEMBER_KEY);
    }
  }, [hydrated, activeMemberId]);

  useEffect(() => {
    if (!hydrated || !family || !activeMemberId) {
      return;
    }

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    subscribeToRemoteFamily({
      familyId: family.id,
      onError: setSyncError,
      onFamily: (remoteFamily) => {
        setSyncError(null);
        setFamily(remoteFamily);
      },
    })
      .then((nextUnsubscribe) => {
        if (cancelled) {
          nextUnsubscribe();
          return;
        }
        unsubscribe = nextUnsubscribe;
      })
      .catch((error) => setSyncError(getErrorMessage(error)));

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [activeMemberId, family?.id, hydrated]);

  const createProfileAndFamily = useCallback(
    async ({ yourName, childName, childEmail }: CreateFamilyInput) => {
      const remoteSession = await createRemoteProfileAndFamily({
        yourName,
        childName,
        childEmail,
      });

      if (remoteSession) {
        setSyncError(null);
        setProfile(remoteSession.profile);
        setFamily(remoteSession.family);
        setFamilyMemberships(remoteSession.familyMemberships);
        setActiveMemberIdState(remoteSession.activeMemberId);
        return;
      }
    },
    [],
  );

  const addInvite = useCallback(
    async (label: string) => {
      if (!family || !profile) {
        throw new Error("Cannot create an invite before a family exists.");
      }
      const invite = createInvite({ label, createdBy: profile.id });
      const nextFamily = { ...family, invites: [...family.invites, invite] };
      const wroteRemote = await createRemoteInvite({ family, invite });

      if (!wroteRemote) {
        throw new Error("Firebase is not configured.");
      } else {
        setSyncError(null);
      }

      setFamily(nextFamily);
      return invite;
    },
    [family, profile],
  );

  const connectGoogleDelivery = useCallback(async () => {
    const familyId = family?.id;
    if (!familyId) {
      throw new Error("Cannot connect Google delivery before a family exists.");
    }
    const previousDeliveryUpdatedAt = family.deliveryConnection?.updatedAt;

    await connectGoogleDeliveryRemote({
      familyId,
    });

    for (const intervalMs of googleDeliveryPollIntervalsMs) {
      await wait(intervalMs);
      const remoteFamily = await fetchRemoteFamily(familyId);
      setFamily(remoteFamily);

      const connection = remoteFamily.deliveryConnection;
      if (!connection) {
        continue;
      }

      if (connection.status === "connected") {
        setSyncError(null);
        return;
      }

      if (
        connection.status === "needs_reconnect" &&
        connection.updatedAt !== previousDeliveryUpdatedAt
      ) {
        throw new Error("Google delivery needs to be reconnected.");
      }
    }

    throw new Error(
      "Dinomay received Google permission, but delivery status did not update yet. Open Settings again in a moment.",
    );
  }, [family]);

  const joinWithCode = useCallback(
    async ({ yourName, code }: { yourName: string; code: string }) => {
      const remoteSession = await joinRemoteFamilyWithCode({ yourName, code });
      if (remoteSession) {
        setSyncError(null);
        setFamily(remoteSession.family);
        setFamilyMemberships(remoteSession.familyMemberships);
        setProfile(remoteSession.profile);
        setActiveMemberIdState(remoteSession.activeMemberId);
        return true;
      }

      return false;
    },
    [],
  );

  const updateDeliveryCcEmails = useCallback(
    async (ccEmails: string[]) => {
      if (!family) {
        throw new Error(
          "Cannot update delivery settings before a family exists.",
        );
      }

      const normalizedCcEmails = normalizeEmailList(ccEmails);
      await updateRemoteFamilyDeliveryCcEmails({
        ccEmails: normalizedCcEmails,
        familyId: family.id,
      });
      setSyncError(null);
      setFamily((current) =>
        current?.id === family.id
          ? {
              ...current,
              deliveryCcEmails:
                normalizedCcEmails.length > 0 ? normalizedCcEmails : undefined,
            }
          : current,
      );
    },
    [family],
  );

  const switchFamily = useCallback(
    async (familyId: string) => {
      if (family?.id === familyId) {
        return;
      }

      const remoteSession = await switchRemoteFamily(familyId);
      setSyncError(null);
      setFamily(remoteSession.family);
      setFamilyMemberships(remoteSession.familyMemberships);
      setProfile(remoteSession.profile);
      setActiveMemberIdState(remoteSession.activeMemberId);
    },
    [family?.id],
  );

  const signInWithGoogle = useCallback(async () => {
    await signInWithGoogleRemote();
  }, []);

  const signOut = useCallback(async () => {
    await signOutCurrentUser();
    setAuthUser(null);
    setAuthStatus("signed-out");
    setProfile(null);
    setFamily(null);
    setFamilyMemberships([]);
    setActiveMemberIdState(null);
  }, []);

  const setActiveMemberId = useCallback((memberId: string) => {
    setActiveMemberIdState(memberId);
  }, []);

  const reset = useCallback(() => {
    if (family) {
      removeLocalItem(wallStorageKey(family.id));
    }
    setProfile(null);
    setFamily(null);
    setFamilyMemberships([]);
    setActiveMemberIdState(null);
    setSyncError(null);
  }, [family]);

  const activeMember = useMemo(() => {
    if (!family || !activeMemberId) {
      return null;
    }
    return (
      family.members.find((member) => member.id === activeMemberId) ?? null
    );
  }, [family, activeMemberId]);

  const visibleFamilyMemberships = useMemo(() => {
    if (!family || !activeMember) {
      return familyMemberships;
    }

    const byFamilyId = new Map(
      familyMemberships.map((membership) => [membership.familyId, membership]),
    );
    const existingMembership = byFamilyId.get(family.id);
    byFamilyId.set(family.id, {
      ...existingMembership,
      childEmail: family.childEmail,
      childName: family.childName,
      familyId: family.id,
      joinedAt: activeMember.joinedAt,
      memberId: activeMember.id,
      role: activeMember.role,
      updatedAt: existingMembership?.updatedAt ?? activeMember.joinedAt,
    });

    return sortFamilyMemberships([...byFamilyId.values()]);
  }, [activeMember, family, familyMemberships]);

  const value = useMemo<AppStateValue>(
    () => ({
      authStatus,
      authUser,
      hydrated,
      isRestoringSession,
      profile,
      family,
      familyMemberships: visibleFamilyMemberships,
      activeMemberId,
      activeMember,
      isReady: authStatus === "signed-in" && Boolean(family && activeMemberId),
      syncError,
      signInWithGoogle,
      signOut,
      createProfileAndFamily,
      addInvite,
      connectGoogleDelivery,
      joinWithCode,
      updateDeliveryCcEmails,
      setActiveMemberId,
      switchFamily,
      reset,
    }),
    [
      authStatus,
      authUser,
      hydrated,
      isRestoringSession,
      profile,
      family,
      visibleFamilyMemberships,
      activeMemberId,
      activeMember,
      syncError,
      signInWithGoogle,
      signOut,
      createProfileAndFamily,
      addInvite,
      connectGoogleDelivery,
      joinWithCode,
      updateDeliveryCcEmails,
      setActiveMemberId,
      switchFamily,
      reset,
    ],
  );

  return (
    <AppStateContext.Provider value={value}>
      {children}
    </AppStateContext.Provider>
  );
}

export function useAppState() {
  const value = useContext(AppStateContext);
  if (!value) {
    throw new Error("useAppState must be used within an AppStateProvider.");
  }
  return value;
}

/** Convenience: resolve any member id to a display name + initials. */
export function useMemberResolver() {
  const { family } = useAppState();
  return useCallback(
    (memberId: string) =>
      family
        ? resolveMember(family, memberId)
        : { displayName: "Someone", initials: "?" },
    [family],
  );
}
