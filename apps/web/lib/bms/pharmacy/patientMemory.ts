export type PatientKnownFields = Record<string, string | number | boolean | null | undefined>;

export type ReusablePatientProfileCandidate = {
  id: string;
  patientAgeYears: number | null;
  biologicalSex: string;
  structuredAnswers: Record<string, unknown>;
  customerConfirmedAt: string | null;
  consentAt: string | null;
  updatedAt: string;
};

export type RememberedPatientProfile = {
  fields: Record<string, string | number>;
  fieldSources: Record<string, string>;
  sourceAssessmentIds: string[];
};

const REMEMBERED_FIELD_KEYS = new Set([
  "patient_age_years",
  "biological_sex",
  "allergies",
  "chronic_diseases",
]);

const AGE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

function referenceTime(candidate: ReusablePatientProfileCandidate): number {
  const value = candidate.customerConfirmedAt || candidate.consentAt || candidate.updatedAt;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function isPresent(value: unknown): value is string | number | boolean {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function isReusableValue(value: unknown): value is string | number {
  return (typeof value === "string" || typeof value === "number") && isPresent(value);
}

/** Select the newest confirmed value independently for each reusable field. */
export function buildReusablePatientProfile(
  candidates: ReusablePatientProfileCandidate[],
  nowMs = Date.now()
): RememberedPatientProfile | null {
  const fields: Record<string, string | number> = {};
  const fieldSources: Record<string, string> = {};
  const ordered = [...candidates].sort((a, b) => referenceTime(b) - referenceTime(a));

  const remember = (field: string, value: unknown, sourceId: string) => {
    if (field in fields || !isReusableValue(value)) return;
    fields[field] = value;
    fieldSources[field] = sourceId;
  };

  for (const candidate of ordered) {
    const ageReferenceMs = referenceTime(candidate);
    const ageElapsedMs = nowMs - ageReferenceMs;
    if (ageElapsedMs >= 0 && ageElapsedMs <= AGE_MAX_AGE_MS) {
      remember("patient_age_years", candidate.patientAgeYears, candidate.id);
    }
    if (candidate.biologicalSex !== "UNKNOWN") {
      remember("biological_sex", candidate.biologicalSex, candidate.id);
    }
    remember("allergies", candidate.structuredAnswers.allergies, candidate.id);
    remember("chronic_diseases", candidate.structuredAnswers.chronic_diseases, candidate.id);
    if (Object.keys(fields).length === REMEMBERED_FIELD_KEYS.size) break;
  }

  if (Object.keys(fields).length === 0) return null;
  return {
    fields,
    fieldSources,
    sourceAssessmentIds: [...new Set(Object.values(fieldSources))],
  };
}

export function compactPatientFields(fields: PatientKnownFields): PatientKnownFields {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => isPresent(value)));
}

export function mergeRememberedFields(
  currentKnownFields: PatientKnownFields,
  rememberedProfile: RememberedPatientProfile | null
): PatientKnownFields {
  if (!rememberedProfile) return { ...currentKnownFields };
  const merged: PatientKnownFields = { ...currentKnownFields };
  for (const [key, value] of Object.entries(rememberedProfile.fields)) {
    if (!REMEMBERED_FIELD_KEYS.has(key) || isPresent(merged[key])) continue;
    merged[key] = value;
  }
  return merged;
}

/** Latest explicit customer values always win; null/blank model output never clears known data. */
export function mergeLatestPatientFields(
  knownFields: PatientKnownFields,
  latestFields: PatientKnownFields
): PatientKnownFields {
  return { ...knownFields, ...compactPatientFields(latestFields) };
}

export function rememberedFieldKeysAdded(
  currentKnownFields: PatientKnownFields,
  rememberedProfile: RememberedPatientProfile | null
): string[] {
  if (!rememberedProfile) return [];
  return Object.keys(rememberedProfile.fields).filter(
    (key) => REMEMBERED_FIELD_KEYS.has(key) && !isPresent(currentKnownFields[key])
  );
}

export function rememberedSourceAssessmentIds(
  rememberedProfile: RememberedPatientProfile,
  fieldKeys: string[]
): string[] {
  return [...new Set(fieldKeys.map((key) => rememberedProfile.fieldSources[key]).filter(Boolean))];
}
