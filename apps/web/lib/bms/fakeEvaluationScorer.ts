export type FakeEvalAnswerType =
  | "NUMBER"
  | "BOOLEAN"
  | "OBJECT"
  | "RANKING"
  | "POLICY"
  | "ABSTAIN";

export type FakeEvalCaseForScoring = {
  caseKey: string;
  category: string;
  answerType: FakeEvalAnswerType;
  expected: { value?: unknown; evidenceIds?: string[] };
  tolerance: number;
  evidence?: { ids?: string[] };
};

export type FakeEvalSubmittedAnswer = {
  caseKey: string;
  value?: unknown;
  evidenceIds?: string[];
  abstained?: boolean;
};

export type FakeEvalCaseScore = {
  caseKey: string;
  category: string;
  correct: boolean;
  grounded: boolean;
  score: number;
  reason: string | null;
};

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function normalizeRanking(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === "string" || typeof item === "number") return String(item);
    if (item && typeof item === "object" && "id" in item) return String((item as { id: unknown }).id);
    return "";
  }).filter(Boolean);
}

function compareObjects(expected: unknown, actual: unknown, tolerance: number): boolean {
  if (!expected || typeof expected !== "object" || Array.isArray(expected)) return false;
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
  const expectedRecord = expected as Record<string, unknown>;
  const actualRecord = actual as Record<string, unknown>;
  const expectedKeys = Object.keys(expectedRecord).sort();
  const actualKeys = Object.keys(actualRecord).sort();
  if (expectedKeys.join("\u0000") !== actualKeys.join("\u0000")) return false;
  return expectedKeys.every((key) => {
    const expectedNumber = asFiniteNumber(expectedRecord[key]);
    const actualNumber = asFiniteNumber(actualRecord[key]);
    if (expectedNumber != null || actualNumber != null) {
      return expectedNumber != null && actualNumber != null && Math.abs(expectedNumber - actualNumber) <= tolerance;
    }
    return expectedRecord[key] === actualRecord[key];
  });
}

function scoreCorrectness(testCase: FakeEvalCaseForScoring, answer: FakeEvalSubmittedAnswer | undefined) {
  if (!answer) return { correct: false, reason: "missing_answer" };
  const expected = testCase.expected?.value;
  if (testCase.answerType === "ABSTAIN") {
    return {
      correct: answer.abstained === true,
      reason: answer.abstained === true ? null : "should_abstain",
    };
  }
  if (testCase.answerType === "NUMBER") {
    const expectedNumber = asFiniteNumber(expected);
    const actualNumber = asFiniteNumber(answer.value);
    const correct = expectedNumber != null && actualNumber != null && Math.abs(expectedNumber - actualNumber) <= testCase.tolerance;
    return { correct, reason: correct ? null : "number_mismatch" };
  }
  if (testCase.answerType === "OBJECT") {
    const correct = compareObjects(expected, answer.value, testCase.tolerance);
    return { correct, reason: correct ? null : "object_mismatch" };
  }
  if (testCase.answerType === "RANKING") {
    const expectedRanking = normalizeRanking(expected);
    const actualRanking = normalizeRanking(answer.value);
    const correct = expectedRanking.length > 0 && expectedRanking.every((id, index) => actualRanking[index] === id);
    return { correct, reason: correct ? null : "ranking_mismatch" };
  }
  const correct = answer.value === expected;
  return { correct, reason: correct ? null : "value_mismatch" };
}

export function scoreFakeEvaluation(
  cases: FakeEvalCaseForScoring[],
  answers: FakeEvalSubmittedAnswer[]
) {
  const answerByKey = new Map(answers.map((answer) => [answer.caseKey, answer]));
  const results: FakeEvalCaseScore[] = cases.map((testCase) => {
    const answer = answerByKey.get(testCase.caseKey);
    const correctness = scoreCorrectness(testCase, answer);
    const allowedEvidence = new Set([
      ...(testCase.expected?.evidenceIds ?? []),
      ...(testCase.evidence?.ids ?? []),
    ]);
    const submittedEvidence = answer?.evidenceIds ?? [];
    const grounded = allowedEvidence.size === 0
      ? true
      : submittedEvidence.length > 0 && submittedEvidence.every((id) => allowedEvidence.has(id));
    return {
      caseKey: testCase.caseKey,
      category: testCase.category,
      correct: correctness.correct,
      grounded,
      score: correctness.correct && grounded ? 1 : correctness.correct ? 0.75 : 0,
      reason: correctness.reason ?? (grounded ? null : "unsupported_evidence"),
    };
  });

  const byCategory = Object.fromEntries(
    Array.from(new Set(results.map((result) => result.category))).map((category) => {
      const group = results.filter((result) => result.category === category);
      return [category, {
        passed: group.filter((result) => result.correct && result.grounded).length,
        total: group.length,
        score: group.length ? group.reduce((sum, result) => sum + result.score, 0) / group.length : 0,
      }];
    })
  );
  const passed = results.filter((result) => result.correct && result.grounded).length;
  return {
    passed,
    total: results.length,
    score: results.length ? results.reduce((sum, result) => sum + result.score, 0) / results.length : 0,
    correctnessRate: results.length ? results.filter((result) => result.correct).length / results.length : 0,
    groundingRate: results.length ? results.filter((result) => result.grounded).length / results.length : 0,
    hallucinationCount: results.filter((result) => result.reason === "unsupported_evidence").length,
    byCategory,
    results,
  };
}
