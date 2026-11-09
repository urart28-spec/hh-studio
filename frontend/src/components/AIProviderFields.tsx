export const AI_PROVIDERS = {
  openai: {
    label: "OpenAI",
    defaultModel: "gpt-4.1-mini",
    keyLabel: "API-ключ",
    keyHelp: "API-ключ из кабинета OpenAI.",
  },
  anthropic: {
    label: "Anthropic",
    defaultModel: "claude-sonnet-4-5",
    keyLabel: "API-ключ",
    keyHelp: "API-ключ из кабинета Anthropic.",
  },
  gemini: {
    label: "Google Gemini",
    defaultModel: "gemini-2.5-flash",
    keyLabel: "API-ключ",
    keyHelp: "API-ключ из Google AI Studio.",
  },
  deepseek: {
    label: "DeepSeek",
    defaultModel: "deepseek-flash",
    keyLabel: "API-ключ DeepSeek",
    keyHelp:
      "Ключ из platform.deepseek.com. Подписка на веб-чат не заменяет баланс API.",
  },
  gigachat: {
    label: "GigaChat",
    defaultModel: "GigaChat-3-Ultra",
    keyLabel: "Authorization Key GigaChat",
    keyHelp:
      "Вставьте Authorization Key из кабинета GigaChat API, а не временный access_token. Токен доступа будет получен автоматически. Можно вставить ключ с префиксом Basic.",
  },
} as const;

export type AIProvider = keyof typeof AI_PROVIDERS;
export type GigaChatScope =
  | "GIGACHAT_API_PERS"
  | "GIGACHAT_API_B2B"
  | "GIGACHAT_API_CORP";

type Props = {
  provider: AIProvider;
  model: string;
  gigachatScope: GigaChatScope;
  caBundle: string;
  onProviderChange: (provider: AIProvider) => void;
  onModelChange: (value: string) => void;
  onScopeChange: (value: GigaChatScope) => void;
  onCaBundleChange: (value: string) => void;
};

export function AIProviderFields({
  provider,
  model,
  gigachatScope,
  caBundle,
  onProviderChange,
  onModelChange,
  onScopeChange,
  onCaBundleChange,
}: Props) {
  return (
    <>
      <label className="field">
        <span>AI-провайдер</span>
        <select
          value={provider}
          onChange={(event) =>
            onProviderChange(event.target.value as AIProvider)
          }
        >
          {Object.entries(AI_PROVIDERS).map(([id, info]) => (
            <option key={id} value={id}>
              {info.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>ID модели</span>
        <input
          value={model}
          onChange={(event) => onModelChange(event.target.value)}
          maxLength={100}
        />
        {provider === "gigachat" && (
          <small>
            GigaChat-3-Ultra — для freemium-доступа физлиц. Для платного доступа
            укажите ID модели, доступной вашему аккаунту.
          </small>
        )}
      </label>
      {provider === "gigachat" && (
        <>
          <label className="field full">
            <span>Тип доступа GigaChat (scope)</span>
            <select
              value={gigachatScope}
              onChange={(event) =>
                onScopeChange(event.target.value as GigaChatScope)
              }
            >
              <option value="GIGACHAT_API_PERS">Физическое лицо — PERS</option>
              <option value="GIGACHAT_API_B2B">
                ИП / юрлицо, пакеты — B2B
              </option>
              <option value="GIGACHAT_API_CORP">
                ИП / юрлицо, pay-as-you-go — CORP
              </option>
            </select>
          </label>
          <label className="field full">
            <span>
              Путь к CA-сертификату <em>необязательно</em>
            </span>
            <input
              value={caBundle}
              onChange={(event) => onCaBundleChange(event.target.value)}
              maxLength={1000}
              placeholder="Например, C:\certs\russian_trusted_root_ca_pem.crt"
            />
            <small>
              Оставьте пустым, если сертификат уже доверен в системе. При ошибке
              TLS скачайте CA-сертификат по{" "}
              <a
                className="inline-link"
                href="https://developers.sber.ru/docs/ru/gigachat/certificates"
                target="_blank"
                rel="noreferrer"
              >
                официальной инструкции GigaChat
              </a>{" "}
              и укажите полный путь к PEM/CRT-файлу.
            </small>
          </label>
        </>
      )}
    </>
  );
}
