import type { CheckResult, ReportResult } from '../types.js';
import { CATEGORIES } from '../constants.js';
import type { CheckScore, Grade, ScoreCap, ScoreResult } from './types.js';
import { getCheckWeight } from './weights.js';
import { getCheckProportion } from './proportions.js';
import { getCoefficient } from './coefficients.js';
import { evaluateDiagnostics } from './diagnostics.js';
import { getResolution } from './resolutions.js';
import { computeTagScores } from './tag-scores.js';

/**
 * Compute a score from a report result.
 *
 * This is the main entry point for the scoring module. It is a pure function
 * that reads a ReportResult and returns a standalone ScoreResult.
 */
export function computeScore(report: ReportResult): ScoreResult {
  const resultMap = new Map<string, CheckResult>();
  for (const r of report.results) {
    resultMap.set(r.id, r);
  }

  // Compute per-check scores
  const checkScores: Record<string, CheckScore> = {};

  for (const result of report.results) {
    const weight = getCheckWeight(result.id);
    if (!weight) continue;

    const proportionResult = getCheckProportion(result, weight);
    if (!proportionResult) {
      // Skipped or error: excluded from scoring entirely
      continue;
    }

    const coefficient = getCoefficient(result.id, resultMap);
    const effectiveWeight = weight.weight * coefficient;
    const earnedScore = proportionResult.proportion * effectiveWeight;

    checkScores[result.id] = {
      baseWeight: weight.weight,
      coefficient,
      effectiveWeight,
      proportion: proportionResult.proportion,
      earnedScore,
      maxScore: effectiveWeight,
    };
  }

  // Overall score
  let totalEarned = 0;
  let totalMax = 0;

  for (const cs of Object.values(checkScores)) {
    totalEarned += cs.earnedScore;
    totalMax += cs.maxScore;
  }

  const rawScore = totalMax > 0 ? (totalEarned / totalMax) * 100 : 0;

  // Diagnostics (evaluated before caps so no-viable-path can trigger a cap)
  const diagnostics = evaluateDiagnostics(resultMap);
  const triggeredDiagnostics = new Set(diagnostics.map((d) => d.id));

  // Apply critical check caps
  const cap = computeCap(checkScores, resultMap, triggeredDiagnostics);
  const overall = Math.round(cap ? Math.min(rawScore, cap.cap) : rawScore);

  // Category scores
  const categoryScores: Record<string, { score: number; grade: Grade }> = {};

  for (const cat of CATEGORIES) {
    let catEarned = 0;
    let catMax = 0;

    for (const result of report.results) {
      if (result.category !== cat.id) continue;
      const cs = checkScores[result.id];
      if (!cs) continue;
      catEarned += cs.earnedScore;
      catMax += cs.maxScore;
    }

    categoryScores[cat.id] = {
      score: catMax > 0 ? Math.round((catEarned / catMax) * 100) : 0,
      grade: toGrade(catMax > 0 ? Math.round((catEarned / catMax) * 100) : 0),
    };
  }

  // Resolutions
  const resolutions: Record<string, string> = {};
  for (const result of report.results) {
    const resolution = getResolution(result);
    if (resolution) {
      resolutions[result.id] = resolution;
    }
  }

  const scoreResult: ScoreResult = {
    overall,
    grade: toGrade(overall),
    categoryScores,
    checkScores,
    diagnostics,
    resolutions,
  };

  if (cap && cap.cap < rawScore) {
    scoreResult.cap = cap;
  }

  const tagScores = computeTagScores(report, checkScores);
  if (tagScores) {
    scoreResult.tagScores = tagScores;
  }

  return scoreResult;
}

// ---------------------------------------------------------------------------
// Caps
// ---------------------------------------------------------------------------

function computeCap(
  checkScores: Record<string, CheckScore>,
  results: Map<string, CheckResult>,
  triggeredDiagnostics: Set<string>,
): ScoreCap | undefined {
  const caps: ScoreCap[] = [];

  // llms-txt-exists: single-resource critical, caps at 59 on fail
  const llmsExists = results.get('llms-txt-exists');
  if (llmsExists?.status === 'fail') {
    caps.push({
      cap: 59,
      checkId: 'llms-txt-exists',
      reason: 'No llms.txt found. Agents lose primary navigation.',
    });
  }

  // Multi-page critical checks: rendering-strategy, auth-gate-detection
  for (const checkId of ['rendering-strategy', 'auth-gate-detection']) {
    const cs = checkScores[checkId];
    if (!cs) continue;

    if (cs.proportion <= 0.25) {
      caps.push({
        cap: 39,
        checkId,
        reason: `${checkId}: 75%+ of pages affected`,
      });
    } else if (cs.proportion <= 0.5) {
      caps.push({
        cap: 59,
        checkId,
        reason: `${checkId}: 50%+ of pages affected`,
      });
    }
  }

  // No viable content path: no llms.txt, no discoverable markdown, HTML path
  // broken or untested. Agents have no effective way to get content.
  if (triggeredDiagnostics.has('no-viable-path')) {
    caps.push({
      cap: 39,
      checkId: 'no-viable-path',
      reason: 'Agents have no effective way to access documentation content.',
    });
  }

  if (caps.length === 0) return undefined;

  // Lowest cap wins
  caps.sort((a, b) => a.cap - b.cap);
  return caps[0];
}

// ---------------------------------------------------------------------------
// Grade
// ---------------------------------------------------------------------------

export function toGrade(score: number): Grade {
  if (score >= 100) return 'A+';
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}
