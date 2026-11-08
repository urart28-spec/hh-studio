import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Use the existing TypeScript compiler and Node test runner, without a browser
// or additional test dependencies. Test the same component used inline/modal.
const project = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = join(project, ".test-runs");
mkdirSync(scratch, { recursive: true });
const temporary = mkdtempSync(join(scratch, "confirmation-"));
const generated = join(temporary, "ConfirmationForm.mjs");
const source = readFileSync(
  join(project, "src/components/ConfirmationForm.tsx"),
  "utf8",
);
writeFileSync(
  generated,
  ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText,
);
after(() => {
  unlinkSync(generated);
  rmdirSync(temporary);
});
const { ConfirmationForm } = await import(pathToFileURL(generated).href);
const defaults = {
  prompt: {
    kind: "otp",
    message: "Введите код из SMS",
    prompt_id: "test-prompt",
  },
  value: "",
  pending: false,
  onChange() {},
  onSubmit() {},
  onCancel() {},
};
const render = (props = {}) =>
  renderToStaticMarkup(
    createElement(ConfirmationForm, { ...defaults, ...props }),
  );

test("OTP has a labeled, enabled input with SMS autofill", () => {
  const html = render();
  assert.match(html, /Код из SMS или email/);
  assert.match(html, /for="confirmation-test-prompt"/);
  const input = html.match(/<input[^>]+>/)[0];
  assert.match(input, /name="otp"/);
  assert.match(input, /autoComplete="one-time-code"/);
  assert.match(input, /inputMode="numeric"/);
  assert.doesNotMatch(input, /disabled/);
  assert.match(html, /Подтвердить/);
});

test("captcha uses its own image and text keyboard", () => {
  const html = render({
    prompt: {
      ...defaults.prompt,
      kind: "captcha",
      image: "data:image/png;base64,test",
    },
  });
  assert.match(html, /<img[^>]*src="data:image\/png;base64,test"/);
  assert.match(html, /Текст с картинки/);
  const input = html.match(/<input[^>]+>/)[0];
  assert.match(input, /name="captcha"/);
  assert.match(input, /autoComplete="off"/);
  assert.match(input, /inputMode="text"/);
});

test("pending confirmation prevents duplicate submits while cancellation stays available", () => {
  const html = render({ pending: true, value: "123456" });
  assert.match(html, /<input[^>]*disabled=""/);
  assert.match(html, /<button type="submit"[^>]*disabled=""/);
  assert.doesNotMatch(html.match(/<button type="button"[^>]*>/)[0], /disabled/);
  let submitted = 0;
  const event = { preventDefault() {} };
  ConfirmationForm({
    ...defaults,
    value: "123456",
    onSubmit: () => submitted++,
  }).props.onSubmit(event);
  ConfirmationForm({
    ...defaults,
    pending: true,
    value: "123456",
    onSubmit: () => submitted++,
  }).props.onSubmit(event);
  ConfirmationForm({
    ...defaults,
    value: "  ",
    onSubmit: () => submitted++,
  }).props.onSubmit(event);
  assert.equal(submitted, 1);
});

test("prompt messages are escaped and never rendered as HTML", () => {
  const html = render({
    prompt: { ...defaults.prompt, message: "<script>untrusted()</script>" },
  });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});
