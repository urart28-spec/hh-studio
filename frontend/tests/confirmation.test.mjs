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
const providerModule = join(temporary, "AIProviderFields.mjs");
const ocrModule = join(temporary, "LocalOCRSettings.mjs");
writeFileSync(ocrModule, ts.transpileModule(
  readFileSync(join(project, "src/components/LocalOCRSettings.tsx"), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } },
).outputText);
writeFileSync(
  providerModule,
  ts.transpileModule(
    readFileSync(join(project, "src/components/AIProviderFields.tsx"), "utf8"),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText,
);
after(() => {
  unlinkSync(generated);
  unlinkSync(providerModule);
  unlinkSync(ocrModule);
  rmdirSync(temporary);
});
const { ConfirmationForm } = await import(pathToFileURL(generated).href);
const { LocalOCRSettings } = await import(pathToFileURL(ocrModule).href);
const { AIProviderFields, AI_PROVIDERS } = await import(
  pathToFileURL(providerModule).href
);
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

const renderProvider = (provider) =>
  renderToStaticMarkup(
    createElement(AIProviderFields, {
      provider,
      model: AI_PROVIDERS[provider].defaultModel,
      gigachatScope: "GIGACHAT_API_PERS",
      caBundle: "",
      onProviderChange() {},
      onModelChange() {},
      onScopeChange() {},
      onCaBundleChange() {},
    }),
  );

test("provider selector exposes DeepSeek and GigaChat while retaining existing providers", () => {
  const html = renderProvider("deepseek");
  for (const provider of [
    "openai",
    "anthropic",
    "gemini",
    "deepseek",
    "gigachat",
  ]) {
    assert.match(html, new RegExp(`<option[^>]*value="${provider}"`));
  }
  assert.match(html, /value="deepseek" selected=""/);
  assert.match(html, /value="deepseek-flash"/);
  assert.doesNotMatch(html, /Тип доступа GigaChat/);
});

test("GigaChat exposes scope and certificate settings only when selected", () => {
  const html = renderProvider("gigachat");
  assert.match(html, /value="gigachat" selected=""/);
  for (const scope of [
    "GIGACHAT_API_PERS",
    "GIGACHAT_API_B2B",
    "GIGACHAT_API_CORP",
  ]) {
    assert.match(html, new RegExp(`value="${scope}"`));
  }
  assert.match(html, /Путь к CA-сертификату/);
  assert.match(
    html,
    /https:\/\/developers.sber.ru\/docs\/ru\/gigachat\/certificates/,
  );
  assert.match(html, /value="GigaChat-3-Ultra"/);
  assert.match(AI_PROVIDERS.gigachat.keyLabel, /Authorization Key/);
});

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

test("automatic OCR blocks manual submission while keeping manual takeover available", () => {
  const prompt = { ...defaults.prompt, kind: "captcha", ocr_status: "recognizing", ocr_auto_submit: true };
  const html = render({ prompt, onCancelRecognition() {} });
  assert.match(html, /Распознаём локально/);
  assert.match(html, /Ввести вручную/);
  assert.match(html, /<input[^>]*disabled=""/);
  assert.match(html, /<button type="submit"[^>]*disabled=""/);
  let submitted = 0;
  ConfirmationForm({ ...defaults, prompt, value: "текст", onSubmit: () => submitted++ })
    .props.onSubmit({ preventDefault() {} });
  assert.equal(submitted, 0);
  const otp = render({ prompt: { ...prompt, kind: "otp" } });
  assert.doesNotMatch(otp, /Распознаём локально/);
  assert.doesNotMatch(otp.match(/<input[^>]+>/)[0], /disabled/);
});

test("OCR failure leaves the field and retry available", () => {
  const html = render({
    prompt: { ...defaults.prompt, kind: "captcha", ocr_status: "failed", ocr_auto_submit: true, ocr_error: "Введите вручную" },
    onRetryRecognition() {},
  });
  assert.match(html, /Введите вручную/);
  assert.match(html, /Распознать ещё раз/);
  assert.doesNotMatch(html.match(/<input[^>]+>/)[0], /disabled/);
});

test("local OCR settings default to on-demand loading and one-minute idle unload", () => {
  const html = renderToStaticMarkup(createElement(LocalOCRSettings, {
    settings: {}, pending: false, status: { available: true, model: "local-model", loaded: false },
    onChange() {}, onCheck() {}, onSave() {},
  }));
  assert.match(html, /value="60" selected=""/);
  assert.match(html, /Сразу после ответа/);
  assert.match(html, /Проверка подключения её не загружает/);
  assert.match(html, /Выгружена, загрузится по запросу/);
  assert.match(html, /value="11434"/);
  assert.doesNotMatch(html, /<input[^>]*type="checkbox"[^>]*checked=""/);
});
