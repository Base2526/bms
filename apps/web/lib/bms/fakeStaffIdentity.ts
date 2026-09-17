// Deterministic display identities for fake staff.
//
// The fake-data endpoints can create up to 200 staff accounts in one shop.  A
// short, cyclic list of complete names made those distinct accounts look like
// duplicate users on the POS PIN screen, which intentionally shows display
// names rather than email addresses.  Combine given names and surnames on
// different cycles so every supported fake account has a distinct, natural
// looking full name while keeping the seed reproducible.

const STAFF_GIVEN_NAMES = [
  { name: "ศิริพร", emailAlias: "siriporn" },
  { name: "กิตติพงศ์", emailAlias: "kittipong" },
  { name: "พิมพ์ชนก", emailAlias: "pimchanok" },
  { name: "ณัฐวุฒิ", emailAlias: "nattawut" },
  { name: "ชลธิชา", emailAlias: "chonticha" },
  { name: "ธนภัทร", emailAlias: "thanapat" },
  { name: "ปวีณา", emailAlias: "paweena" },
  { name: "อาทิตย์", emailAlias: "atit" },
  { name: "วรัญญา", emailAlias: "waranya" },
  { name: "ภูริ", emailAlias: "phuri" },
  { name: "มนัสวี", emailAlias: "manaswee" },
  { name: "ธีรภัทร์", emailAlias: "teerapat" },
  { name: "สุภาวดี", emailAlias: "supawadee" },
  { name: "ธนกฤต", emailAlias: "thanakrit" },
  { name: "ชนากานต์", emailAlias: "chanakan" },
  { name: "ปกรณ์", emailAlias: "pakorn" },
  { name: "นันทิชา", emailAlias: "nanticha" },
  { name: "ภาคภูมิ", emailAlias: "pakpoom" },
  { name: "รวิสรา", emailAlias: "rawisara" },
  { name: "เจษฎา", emailAlias: "jetsada" },
] as const;

const STAFF_SURNAMES = [
  "วัฒนกิจ", "แสงทอง", "รัตนชัย", "เจริญสุข", "อินทร์แก้ว",
  "วงศ์ประเสริฐ", "บุญมี", "ตั้งวัฒนา", "สุขใจ", "เลิศวิไล",
  "ศรีสวัสดิ์", "แก้วกาญจน์", "พิพัฒน์กุล", "มั่นคง", "รุ่งเรืองกิจ",
  "สมบูรณ์ทรัพย์", "เกียรติไพบูลย์", "ธรรมรักษ์", "พูนผล", "ไชยวัฒน์",
] as const;

export type FakeStaffIdentity = {
  name: string;
  emailAlias: string;
};

export function fakeStaffIdentity(index: number): FakeStaffIdentity {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error("fake staff index must be a non-negative integer");
  }

  const givenNameIndex = index % STAFF_GIVEN_NAMES.length;
  const cycle = Math.floor(index / STAFF_GIVEN_NAMES.length);
  const givenName = STAFF_GIVEN_NAMES[givenNameIndex];
  const surname = STAFF_SURNAMES[(givenNameIndex + cycle) % STAFF_SURNAMES.length];
  const series = Math.floor(cycle / STAFF_SURNAMES.length) + 1;

  return {
    // The first 400 combinations stay as natural two-part Thai names. Beyond
    // that, retain uniqueness instead of silently cycling back to index 0.
    name: `${givenName.name} ${surname}${series > 1 ? ` ${series}` : ""}`,
    emailAlias: givenName.emailAlias,
  };
}

/**
 * Allocate display identities that are not already present in this shop.
 *
 * Seed endpoints may be called repeatedly. Starting `fakeStaffIdentity()` at
 * zero for every request makes distinct user rows look duplicated even though
 * their email addresses differ. Keeping allocation separate from the database
 * makes that cross-request rule cheap to test.
 */
export function allocateFakeStaffIdentities(
  count: number,
  occupiedNames: Iterable<string>
): FakeStaffIdentity[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error("fake staff count must be a non-negative integer");
  }

  const occupied = new Set(occupiedNames);
  const allocated: FakeStaffIdentity[] = [];
  let index = 0;

  while (allocated.length < count) {
    const identity = fakeStaffIdentity(index++);
    if (occupied.has(identity.name)) continue;
    occupied.add(identity.name);
    allocated.push(identity);
  }

  return allocated;
}
