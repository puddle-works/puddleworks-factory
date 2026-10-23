/**
 * Prefill an app spec from an agreed outcome spec.
 *
 * An outcome spec (puddleworks.dev/outcome-spec/v1) says what success looks like. An app spec says what to build. This copies
 * across what the first says about the second, links back to where it was
 * agreed, and leaves the rest blank for the builder: the app name is only a
 * suggestion, and the inputs, output, settings and delivery method are the
 * builder's decisions. The starter does not
 * pass parseAppSpec until they are made.
 *
 * Scope in, constraints, assumptions and acceptance criteria have no place in
 * an app spec. The outcome spec is kept beside the app spec it prefilled, so
 * the build plan reads them there.
 *
 * @module
 */
import {
  APP_SPEC_V1,
  type DeliveryMethod,
  type Specification,
  type SpecSource,
} from "../contracts/app_spec_v1.ts";
import type { OutcomeSpec } from "../contracts/outcome_spec_v1.ts";

/** An app spec with the builder's decisions still blank. */
export interface StarterSpec {
  apiVersion: typeof APP_SPEC_V1;
  kind: "AppSpec";
  name: string;
  title: string;
  specification: Specification;
  delivery: { method: DeliveryMethod | "" };
  source: SpecSource;
}

/** What prefilling gave, and what is left. */
export interface Prefill {
  spec: StarterSpec;
  /** One line per field the builder must check or fill in, `<field>: <why>`. */
  toDecide: string[];
  /** Things in the outcome spec to sort out before building. */
  warnings: string[];
}

const MAX_SLUG = 40;

/** A slug for an app name: lowercase ASCII words joined by hyphens, at most 40 characters. */
export function slugFrom(title: string): string {
  const words = title.normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  let slug = "";
  for (const w of words) {
    const next = slug ? `${slug}-${w}` : w;
    if (next.length > MAX_SLUG) break;
    slug = next;
  }
  return slug || words[0]?.slice(0, MAX_SLUG) || "app";
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** Prefill an app spec from an outcome spec. Pure. */
export function prefillAppSpec(outcome: OutcomeSpec): Prefill {
  const { request, specification: s, agreement } = outcome;
  const recordedBy = EMAIL.test(agreement.agreedBy.email)
    ? agreement.agreedBy.email
    : "";
  const recordedAt = ISO_TIME.test(agreement.agreedAt)
    ? agreement.agreedAt
    : "";
  const name = slugFrom(request.title);

  const toDecide = [
    `name: suggested from the title as "${name}"; it names the extension, workflow and folder`,
    "specification.purpose: copied from the desired outcome; make it one bounded purpose in a sentence",
    "specification.inputs: what the person running it enters each time, each typed and required or with a default",
    "specification.output: what one run produces",
    "specification.settings: what the builder sets once per instance (paths, tokens); leave empty if none",
    "delivery.method: one of workflow_form, packaged_script, scheduled_workflow, external_app, manual_process",
  ];
  if (!recordedBy) {
    toDecide.push(
      "specification.recordedBy: the agreement has no usable email; give the email of whoever agreed it",
    );
  }
  if (!recordedAt) {
    toDecide.push(
      `specification.recordedAt: the agreement time "${agreement.agreedAt}" is not an ISO timestamp`,
    );
  }

  const warnings = outcome.openQuestions.map((q) =>
    `Open question from ${q.askedBy}: ${q.question}`
  );
  if (s.acceptanceCriteria.length === 0) {
    warnings.push(
      "The outcome spec has no acceptance criteria, so nothing says when the build is done.",
    );
  }

  return {
    spec: {
      apiVersion: APP_SPEC_V1,
      kind: "AppSpec",
      name,
      title: request.title,
      specification: {
        purpose: s.desiredOutcome,
        inputs: [],
        output: "",
        outOfScope: s.scope.out,
        settings: [],
        recordedBy,
        recordedAt,
      },
      delivery: { method: "" },
      source: {
        url: request.url,
        version: s.version,
        specHash: agreement.specHash,
      },
    },
    toDecide,
    warnings,
  };
}
