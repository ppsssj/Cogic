#!/usr/bin/env node
// P1-K3: validate the Corpus B review status file. The file records, per case, who reviewed what,
// against which commit and packet, and how the reconciliation was decided. Tool output or an AI's own
// review can never make a case REVIEW_ACCEPTED: acceptance needs a human reviewer, a human adjudicator,
// the submission and packet hashes, a reconciliation record and a decision basis.
// Usage: node review-status.mjs --check <review-status.json>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listCases, readJson } from "./review-lib.mjs";

export const STATUSES = ["REVIEW_PENDING", "REVIEW_IN_PROGRESS", "REVIEW_SUBMITTED", "RECONCILIATION_PENDING", "REVIEW_ACCEPTED", "REVIEW_BLOCKED"];
const ORDER = { REVIEW_PENDING: 0, REVIEW_IN_PROGRESS: 1, REVIEW_SUBMITTED: 2, RECONCILIATION_PENDING: 3, REVIEW_ACCEPTED: 4 };
const NON_HUMAN = /\b(claude|gpt|chatgpt|openai|anthropic|gemini|copilot|codex|llm|ai|bot|tool|script|automated|generated)\b/i;
const SHA40 = /^[0-9a-f]{40}$/;
const SHA64 = /^[0-9a-f]{64}$/;

export function checkStatus(doc, caseIds = listCases().map((c) => c.caseId)) {
  const errors = [];
  if (doc.schema !== "corpus-b-review-status/1") errors.push(`schema ${doc.schema}`);
  const seen = new Set();
  const human = (who, type, label, id) => {
    if (!who || typeof who !== "string" || who.trim() === "") errors.push(`${id}: ${label} missing`);
    else if (NON_HUMAN.test(who)) errors.push(`${id}: ${label} "${who}" is not a human reviewer`);
    if (type !== "human") errors.push(`${id}: ${label}Type must be "human"`);
  };
  for (const c of doc.cases ?? []) {
    const id = c.caseId;
    seen.add(id);
    if (!STATUSES.includes(c.status)) {
      errors.push(`${id}: unknown status ${c.status}`);
      continue;
    }
    if (c.status === "REVIEW_BLOCKED") {
      if (!c.blockedReason) errors.push(`${id}: REVIEW_BLOCKED needs blockedReason`);
      continue;
    }
    const level = ORDER[c.status];
    if (level >= 1) {
      if (!doc.independentReviewerSecured) errors.push(`${id}: ${c.status} but independentReviewerSecured is false`);
      human(c.reviewer, c.reviewerType, "reviewer", id);
      if (!SHA40.test(c.targetSha ?? "")) errors.push(`${id}: targetSha must be a 40-hex commit`);
      if (!SHA64.test(c.packetSha256 ?? "")) errors.push(`${id}: packetSha256 must be a 64-hex hash`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(c.startedAt ?? "")) errors.push(`${id}: startedAt date missing`);
    }
    if (level >= 2) {
      if (!SHA64.test(c.submissionSha256 ?? "")) errors.push(`${id}: submissionSha256 must be a 64-hex hash`);
      if (!c.scope) errors.push(`${id}: scope missing`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(c.submittedAt ?? "")) errors.push(`${id}: submittedAt date missing`);
      if (!c.independenceDeclaration) errors.push(`${id}: independenceDeclaration missing`);
    }
    if (level >= 4) {
      human(c.adjudicator, c.adjudicatorType, "adjudicator", id);
      if (!c.reconciliation) errors.push(`${id}: reconciliation record missing`);
      if (!c.decisionBasis || String(c.decisionBasis).trim().length < 10) errors.push(`${id}: decisionBasis missing`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(c.acceptedAt ?? "")) errors.push(`${id}: acceptedAt date missing`);
    }
    if (level === 0 && (c.reviewer || c.submissionSha256 || c.acceptedAt)) errors.push(`${id}: REVIEW_PENDING must not carry review results`);
  }
  for (const id of caseIds) if (!seen.has(id)) errors.push(`${id}: missing from status file`);
  for (const id of seen) if (!caseIds.includes(id)) errors.push(`${id}: not a Corpus B case`);
  return errors;
}

// case.json keeps the P1-K1 REVIEW_PENDING / humanReviewed:false until a v2 records an accepted review.
export function checkCaseJsonConsistency(doc) {
  const errors = [];
  for (const c of listCases()) {
    const cj = readJson(path.join(c.caseDir, "case.json"));
    const st = doc.cases.find((x) => x.caseId === c.caseId)?.status;
    if (cj.authoring?.humanReviewed === true && st !== "REVIEW_ACCEPTED") errors.push(`${c.caseId}: case.json humanReviewed true without REVIEW_ACCEPTED`);
    if (cj.reviewStatus !== "REVIEW_PENDING" && st === "REVIEW_PENDING") errors.push(`${c.caseId}: case.json reviewStatus ${cj.reviewStatus}`);
  }
  return errors;
}

function main() {
  const i = process.argv.indexOf("--check");
  if (i < 0) throw new Error("--check <file>");
  const doc = readJson(path.resolve(process.argv[i + 1]));
  const errors = [...checkStatus(doc), ...checkCaseJsonConsistency(doc)];
  for (const e of errors) console.log(`ERROR ${e}`);
  const t = {};
  for (const c of doc.cases) t[c.status] = (t[c.status] ?? 0) + 1;
  console.log(`review status ${errors.length ? "INVALID" : "OK"}: ${JSON.stringify(t)}; independentReviewerSecured=${doc.independentReviewerSecured}`);
  process.exitCode = errors.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
