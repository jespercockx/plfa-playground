/// <reference types="vitest/globals" />

import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { agdaCompletionSource } from "$lib/codemirror/completion";
import { browserAgdaSource } from "$lib/agda/browser-source";
import config from "../playground.config.json";

function complete(source, explicit = true) {
  const state = EditorState.create({ doc: source });
  return agdaCompletionSource(
    new CompletionContext(state, state.doc.length, explicit),
  );
}

describe("Agda completion", () => {
  it("suggests names declared in the current buffer", () => {
    const result = complete("identity : Set\nidentity = Set\niden");
    expect(result.options.map((option) => option.label)).toContain("identity");
    expect(result.options.map((option) => option.label)).not.toContain("iden");
  });

  it("suggests exports from open builtin imports", () => {
    const result = complete("open import Agda.Builtin.Bool\ntr");
    expect(result.options.map((option) => option.label)).toContain("true");
  });
});

describe("content import rewrite", () => {
  it("is the identity without a rewrite spec", () => {
    const source = `module Hello where
open import Data.Product using (_×_)
answer = {!  !}
`;
    expect(
      browserAgdaSource("/Hello.agda", source, config.importRewrite),
    ).toBe(source);
  });
});
