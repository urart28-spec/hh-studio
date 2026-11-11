import { ArrowRight, Loader2 } from "lucide-react";

export type InputPrompt = {
  kind: string;
  message: string;
  image?: string | null;
  prompt_id: string;
  ocr_status?: "recognizing" | "ready" | "failed" | "manual";
  ocr_auto_submit?: boolean;
  suggested_value?: string;
  ocr_error?: string | null;
};

type Props = {
  prompt: InputPrompt;
  value: string;
  pending: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onCancelRecognition?: () => void;
  onRetryRecognition?: () => void;
};

export function ConfirmationForm({
  prompt,
  value,
  pending,
  onChange,
  onSubmit,
  onCancel,
  onCancelRecognition,
  onRetryRecognition,
}: Props) {
  const captcha = prompt.kind === "captcha";
  const recognizing = captcha && prompt.ocr_status === "recognizing";
  const automatic = captcha && prompt.ocr_auto_submit && (recognizing || prompt.ocr_status === "ready");
  const inputId = `confirmation-${prompt.prompt_id}`;
  return (
    <form
      className="confirmation-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!pending && !automatic && value.trim()) onSubmit();
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
      {captcha && prompt.ocr_status && <div className="ocr-prompt-status" role="status">
        {recognizing ? <><Loader2 className="spin" size={16} /><span>Распознаём локально. Модель загружается по запросу…</span></>
          : prompt.ocr_status === "ready" ? <span>{automatic ? "Текст распознан. Подтверждаем автоматически…" : "Текст распознан локально. Проверьте результат."}</span>
          : prompt.ocr_status === "failed" ? <span>{prompt.ocr_error || "Распознавание не удалось. Введите текст вручную."}</span>
          : <span>Ручной ввод. Автоматическая отправка отменена.</span>}
        {(recognizing || automatic) && onCancelRecognition && <button type="button" className="text-button" onClick={onCancelRecognition}>Ввести вручную</button>}
        {(prompt.ocr_status === "failed" || prompt.ocr_status === "manual") && onRetryRecognition && <button type="button" className="text-button" onClick={onRetryRecognition}>Распознать ещё раз</button>}
      </div>}
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
          disabled={pending || automatic}
        />
      </label>
      <div className="confirmation-actions">
        <button
          type="submit"
          className="button primary"
          disabled={pending || automatic || !value.trim()}
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
