import { ArrowRight, Loader2 } from "lucide-react";

export type InputPrompt = {
  kind: string;
  message: string;
  image?: string | null;
  prompt_id: string;
};

type Props = {
  prompt: InputPrompt;
  value: string;
  pending: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
};

export function ConfirmationForm({
  prompt,
  value,
  pending,
  onChange,
  onSubmit,
  onCancel,
}: Props) {
  const captcha = prompt.kind === "captcha";
  const inputId = `confirmation-${prompt.prompt_id}`;
  return (
    <form
      className="confirmation-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!pending && value.trim()) onSubmit();
      }}
    >
      <p className="confirmation-message" id={`${inputId}-hint`}>
        {prompt.message}
      </p>
      {prompt.image && (
        <img
          className="captcha-image"
          src={prompt.image}
          alt="Капча hh.ru — введите символы с изображения"
        />
      )}
      <label className="field" htmlFor={inputId}>
        <span>{captcha ? "Текст с картинки" : "Код из SMS или email"}</span>
        <input
          id={inputId}
          name={captcha ? "captcha" : "otp"}
          autoFocus
          autoComplete={captcha ? "off" : "one-time-code"}
          inputMode={captcha ? "text" : "numeric"}
          aria-describedby={`${inputId}-hint`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={captcha ? "Введите символы" : "Введите полученный код"}
          required
          maxLength={300}
          disabled={pending}
        />
      </label>
      <div className="confirmation-actions">
        <button
          type="submit"
          className="button primary"
          disabled={pending || !value.trim()}
        >
          {pending ? (
            <Loader2 className="spin" size={16} />
          ) : (
            <ArrowRight size={16} />
          )}
          {pending ? "Подтверждаем…" : "Подтвердить"}
        </button>
        <button type="button" className="button" onClick={onCancel}>
          Отменить
        </button>
      </div>
    </form>
  );
}
