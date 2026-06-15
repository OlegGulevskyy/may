import { createId } from "./memory";

export type FamilyMemberRole = "creator" | "partner";

export type FamilyMember = {
  id: string;
  displayName: string;
  initials: string;
  role: FamilyMemberRole;
  joinedAt: string;
};

export type InviteStatus = "pending" | "accepted";

export type FamilyInvite = {
  code: string;
  /** A warm, human label for who this is for, e.g. "Mom" or "my wife". */
  label: string;
  status: InviteStatus;
  createdBy: string;
  createdAt: string;
  acceptedAt?: string;
  acceptedBy?: string;
};

export type Family = {
  id: string;
  childName: string;
  /** The child's Gmail inbox memories are eventually delivered to. */
  childEmail: string;
  members: FamilyMember[];
  invites: FamilyInvite[];
  createdAt: string;
};

/** The signed-in person on this device. Their id doubles as their member id. */
export type LocalProfile = {
  id: string;
  displayName: string;
  initials: string;
};

// Excludes visually ambiguous characters (I, L, O, 0, 1) so codes are easy to
// read aloud or copy between two parents.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const initialsFromName = (name: string): string => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return "?";
  }
  if (words.length === 1) {
    return words[0]!.slice(0, 1).toUpperCase();
  }
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
};

export const generateInviteCode = (): string => {
  let code = "";
  for (let index = 0; index < 5; index += 1) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return `MAY-${code}`;
};

export const normalizeInviteCode = (raw: string): string =>
  raw.trim().toUpperCase().replace(/\s+/g, "");

export const createFamilyMember = ({
  displayName,
  role,
  id,
}: {
  displayName: string;
  role: FamilyMemberRole;
  id?: string;
}): FamilyMember => ({
  id: id ?? createId("member"),
  displayName: displayName.trim(),
  initials: initialsFromName(displayName),
  role,
  joinedAt: new Date().toISOString(),
});

export const createProfile = (displayName: string): LocalProfile => {
  const id = createId("member");
  return {
    id,
    displayName: displayName.trim(),
    initials: initialsFromName(displayName),
  };
};

export const createFamily = ({
  childName,
  childEmail,
  creator,
}: {
  childName: string;
  childEmail: string;
  creator: FamilyMember;
}): Family => ({
  id: createId("family"),
  childName: childName.trim(),
  childEmail: childEmail.trim(),
  members: [creator],
  invites: [],
  createdAt: new Date().toISOString(),
});

export const createInvite = ({
  label,
  createdBy,
}: {
  label: string;
  createdBy: string;
}): FamilyInvite => ({
  code: generateInviteCode(),
  label: label.trim() || "your partner",
  status: "pending",
  createdBy,
  createdAt: new Date().toISOString(),
});

export const findMember = (
  family: Family,
  memberId: string,
): FamilyMember | undefined =>
  family.members.find((member) => member.id === memberId);

/** Never throws — falls back to a neutral placeholder for unknown ids. */
export const resolveMember = (
  family: Family,
  memberId: string,
): Pick<FamilyMember, "displayName" | "initials"> =>
  findMember(family, memberId) ?? { displayName: "Someone", initials: "?" };

export const findPendingInvite = (
  family: Family,
  code: string,
): FamilyInvite | undefined => {
  const normalized = normalizeInviteCode(code);
  return family.invites.find(
    (invite) => invite.code === normalized && invite.status === "pending",
  );
};

export type AcceptInviteResult = {
  family: Family;
  member: FamilyMember;
};

/**
 * Accepts a pending invite by adding `member` to the family and marking the
 * invite used. Returns `null` when the code is unknown or already redeemed.
 */
export const acceptInvite = (
  family: Family,
  code: string,
  member: FamilyMember,
): AcceptInviteResult | null => {
  const invite = findPendingInvite(family, code);
  if (!invite) {
    return null;
  }

  const acceptedAt = new Date().toISOString();

  return {
    member,
    family: {
      ...family,
      members: [...family.members, member],
      invites: family.invites.map((current) =>
        current.code === invite.code
          ? {
              ...current,
              status: "accepted",
              acceptedAt,
              acceptedBy: member.id,
            }
          : current,
      ),
    },
  };
};

export const pendingInviteFor = (family: Family): FamilyInvite | undefined =>
  family.invites.find((invite) => invite.status === "pending");
