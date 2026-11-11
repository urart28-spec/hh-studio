export type OCRConfig = {
  captcha_ocr_enabled: boolean;
  captcha_ocr_auto_submit: boolean;
  captcha_ocr_model: string;
  captcha_ocr_port: number;
  captcha_ocr_keep_alive: number;
  captcha_ocr_timeout: number;
};
export type OCRStatus = { available: boolean; model: string; loaded?: boolean; keep_alive?: number; message?: string };
type Props = {
  settings: OCRConfig;
  pending: boolean;
  status: OCRStatus | null;
  onChange: <K extends keyof OCRConfig>(key: K, value: OCRConfig[K]) => void;
  onCheck: () => void;
  onSave: () => void;
};

export function LocalOCRSettings({ settings: s, pending, status, onChange, onCheck, onSave }: Props) {
  return <section className="card local-ocr-settings">
    <div className="card-heading"><div><h2>Локальное распознавание капчи</h2><p>PaddleOCR-VL через Ollama — картинки остаются на компьютере</p></div></div>
    <label className="ocr-checkbox"><input type="checkbox" checked={s.captcha_ocr_enabled ?? false} onChange={e => onChange("captcha_ocr_enabled", e.target.checked)} /><span>Распознавать капчу локально</span></label>
    <label className="ocr-checkbox"><input type="checkbox" checked={s.captcha_ocr_auto_submit ?? false} disabled={!s.captcha_ocr_enabled} onChange={e => onChange("captcha_ocr_auto_submit", e.target.checked)} /><span>Подтверждать распознанный текст автоматически</span></label>
    <div className="form-grid">
      <label className="field full"><span>Модель Ollama</span><input value={s.captcha_ocr_model ?? "hh-paddleocr:0.9b-q4_k_m"} maxLength={160} onChange={e => onChange("captcha_ocr_model", e.target.value)} /></label>
      <label className="field"><span>Порт Ollama</span><input type="number" min={1024} max={65535} value={s.captcha_ocr_port ?? 11434} onChange={e => onChange("captcha_ocr_port", +e.target.value)} /></label>
      <label className="field"><span>Выгружать модель через</span><select value={s.captcha_ocr_keep_alive ?? 60} onChange={e => onChange("captcha_ocr_keep_alive", +e.target.value)}><option value={0}>Сразу после ответа</option><option value={30}>30 секунд бездействия</option><option value={60}>60 секунд бездействия</option><option value={120}>2 минуты бездействия</option><option value={300}>5 минут бездействия</option></select></label>
      <label className="field"><span>Таймаут OCR, секунд</span><input type="number" min={5} max={300} value={s.captcha_ocr_timeout ?? 90} onChange={e => onChange("captcha_ocr_timeout", +e.target.value)} /></label>
    </div>
    <p className="subtle-note">Модель загружается только при появлении картинки. Проверка подключения её не загружает. После простоя модель освобождает оперативную и видеопамять; лёгкий сервер Ollama может оставаться запущенным.</p>
    <p className="subtle-note">Если OCR ошибся или недоступен, останется ручной ввод. Коды SMS/email автоматически не распознаются и не отправляются.</p>
    {status && <div className={status.available ? "info" : "warning"} role="status">{status.available ? `${status.model}: готова. ${status.loaded ? "Сейчас загружена в память." : "Выгружена, загрузится по запросу."}` : status.message}</div>}
    <div className="card-actions"><button className="button primary" disabled={pending} onClick={onSave}>Сохранить OCR</button><button className="button" disabled={pending} onClick={onCheck}>Проверить Ollama</button></div>
  </section>;
}
