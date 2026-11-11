import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  CirclePause,
  Clock3,
  Code2,
  Copy,
  FileText,
  History,
  LayoutDashboard,
  Loader2,
  Menu,
  Moon,
  MoreHorizontal,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Sun,
  Terminal,
  Trash2,
  Unplug,
  Users,
  X,
  Zap,
} from "lucide-react";
import "./styles.css";
import {
  AIProviderFields,
  AI_PROVIDERS,
  type AIProvider,
  type GigaChatScope,
} from "./components/AIProviderFields";
import {
  ConfirmationForm,
  type InputPrompt,
} from "./components/ConfirmationForm";
import {
  LocalOCRSettings,
  type OCRConfig,
  type OCRStatus,
} from "./components/LocalOCRSettings";

type Page =
  | "overview"
  | "apply"
  | "letters"
  | "resumes"
  | "history"
  | "terminal"
  | "accounts"
  | "settings";
type Settings = OCRConfig & {
  text: string;
  area: string;
  salary: number;
  experience: string;
  schedule: string;
  resume_id: string;
  excluded_words: string[];
  excluded_companies: string[];
  delay_min: number;
  delay_max: number;
  max_responses: number;
  total_pages: number;
  daily_limit: number;
  dry_run: boolean;
  letter_mode: string;
  cover_letter: string;
  provider: AIProvider;
  model: string;
  gigachat_scope: GigaChatScope;
  gigachat_ca_bundle: string;
  system_prompt: string;
  experience_context: string;
};
type Profile = {
  id: string;
  name: string;
  settings: Settings;
  account: { name: string; email?: string } | null;
  resumes: Resume[];
  synced_at: string | null;
  has_api_key: Record<string, boolean>;
};
type Resume = {
  id: string;
  title: string;
  status: { id: string; name: string };
  updated_at?: string;
  can_update: boolean;
  url: string;
};
type Job = {
  id: string;
  profile_id: string;
  operation: string;
  status: string;
  started_at: string;
  processed: number;
  sent: number;
  detail: string;
};
type Log = { id: number; at: string; level: string; message: string };
type Entry = {
  id: number;
  at: string;
  title: string;
  company: string;
  url: string;
  status: string;
};
type Schedule = {
  operation: string;
  enabled: number;
  hours: number;
  next_run: string;
};
type State = {
  profile: Profile;
  profiles: { id: string; name: string }[];
  jobs: Job[];
  active: Job | null;
  prompt: InputPrompt | null;
  wait_seconds: number;
  letter_preview: string | null;
  schedules: Schedule[];
  stats: {
    sent_24h: number;
    series: { day: string; count: number }[];
    history_count: number;
  };
  has_token: boolean;
  history: Entry[];
};

const navigation: {
  id: Page;
  label: string;
  icon: typeof LayoutDashboard;
  badge?: string;
}[] = [
  { id: "overview", label: "Обзор", icon: LayoutDashboard },
  { id: "apply", label: "Автоотклики", icon: Send },
  { id: "letters", label: "Сопроводительное", icon: Sparkles, badge: "AI" },
  { id: "resumes", label: "Мои резюме", icon: FileText },
  { id: "history", label: "История откликов", icon: History },
  { id: "terminal", label: "Живые логи", icon: Terminal },
];
const pageNames: Record<Page, string> = {
  overview: "Обзор",
  apply: "Автоотклики",
  letters: "Сопроводительное письмо",
  resumes: "Мои резюме",
  history: "История откликов",
  terminal: "Живые логи",
  accounts: "Аккаунты",
  settings: "Настройки",
};
const date = (value?: string | null, options?: Intl.DateTimeFormatOptions) =>
  value
    ? new Date(value).toLocaleString(
        "ru-RU",
        options || {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        },
      )
    : "Ещё не обновлялось";
const safeUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" &&
      (parsed.hostname === "hh.ru" || parsed.hostname.endsWith(".hh.ru"))
      ? url
      : undefined;
  } catch {
    return undefined;
  }
};
const statusNames: Record<string, string> = {
  running: "В работе",
  waiting: "Ожидает ввода",
  completed: "Завершено",
  failed: "Ошибка",
  stopped: "Остановлено",
  stopping: "Остановка",
  interrupted: "Прервано",
};

function App() {
  const [page, setPage] = useState<Page>(
    (location.hash.slice(1) as Page) in pageNames
      ? (location.hash.slice(1) as Page)
      : "overview",
  );
  const [state, setState] = useState<State | null>(null),
    [settings, setSettings] = useState<Settings | null>(null),
    [profileId, setProfileId] = useState("");
  const [csrf, setCsrf] = useState(""),
    [version, setVersion] = useState(""),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [pending, setPending] = useState(false),
    [dirty, setDirty] = useState(false),
    [connected, setConnected] = useState(false);
  const [theme, setTheme] = useState(
      localStorage.getItem("hh-theme") || "light",
    ),
    [mobile, setMobile] = useState(false),
    [help, setHelp] = useState(false),
    [notifications, setNotifications] = useState(false);
  const [toast, setToast] = useState<{
      message: string;
      error: boolean;
    } | null>(null),
    [username, setUsername] = useState(""),
    [newName, setNewName] = useState(""),
    [newProfile, setNewProfile] = useState(false);
  const [apiKey, setApiKey] = useState(""),
    [reply, setReply] = useState(""),
    [level, setLevel] = useState("ALL"),
    [logSearch, setLogSearch] = useState(""),
    [logs, setLogs] = useState<Log[]>([]);
  const [authCodeSubmitted, setAuthCodeSubmitted] = useState(false);
  const [ocrStatus, setOcrStatus] = useState<OCRStatus | null>(null);
  const [historySearch, setHistorySearch] = useState(""),
    [historyFilter, setHistoryFilter] = useState("all"),
    [historyPage, setHistoryPage] = useState(0),
    [chartDays, setChartDays] = useState(7),
    [syntax, setSyntax] = useState(false);
  const tokenRef = useRef(""),
    tab = useRef(crypto.randomUUID()),
    terminalEnd = useRef<HTMLDivElement>(null),
    dirtyRef = useRef(false),
    stopVersion = useRef(0);
  const notify = (message: string, isError = false) =>
    setToast({ message, error: isError });
  const go = (p: Page) => {
    setPage(p);
    location.hash = p;
    setMobile(false);
    setNotifications(false);
    window.scrollTo({ top: 0 });
  };
  const api = async (path: string, method = "GET", body?: unknown) => {
    const response = await fetch("/api" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": tokenRef.current,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const data = await response
        .json()
        .catch(() => ({ detail: "Сервер недоступен" }));
      throw new Error(
        typeof data.detail === "string"
          ? data.detail
          : data.detail?.map((d: { msg: string }) => d.msg).join("; ") ||
            "Проверьте введённые данные",
      );
    }
    return response.json();
  };
  const refresh = async (id = profileId) => {
    const next = await api("/profiles/" + id);
    setState(next);
    return next as State;
  };
  const act = async (fn: () => Promise<void>) => {
    if (pending) return;
    setPending(true);
    try {
      await fn();
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setPending(false);
    }
  };
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("hh-theme", theme);
  }, [theme]);
  useEffect(() => {
    const changed = () => {
      const next = location.hash.slice(1) as Page;
      if (next in pageNames) {
        setPage(next);
        setMobile(false);
      }
    };
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);
  useEffect(() => {
    api("/bootstrap")
      .then((data) => {
        tokenRef.current = data.csrf_token;
        setCsrf(data.csrf_token);
        setVersion(data.upstream_version || "Не установлена");
        setProfileId(data.profile_id);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);
  useEffect(() => {
    if (!profileId || !csrf) return;
    let cancelled = false;
    setLoading(true);
    setDirty(false);
    dirtyRef.current = false;
    setApiKey("");
    setReply("");
    setAuthCodeSubmitted(false);
    api("/profiles/" + profileId)
      .then((data) => {
        if (!cancelled) {
          setState(data);
          setSettings(data.profile.settings);
          setLoading(false);
        }
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
    const events = new EventSource(
      "/api/profiles/" + profileId + "/events?tab=" + tab.current,
    );
    events.addEventListener("state", (event) => {
      if (cancelled) return;
      const next = JSON.parse(event.data);
      setState(next);
      setLogs(next.logs);
      setConnected(true);
      if (!dirtyRef.current) setSettings(next.profile.settings);
    });
    events.onerror = () => setConnected(false);
    return () => {
      cancelled = true;
      events.close();
    };
  }, [profileId, csrf]);
  useEffect(() => {
    if (!csrf) return;
    const beat = () => {
      void api("/lease/" + tab.current, "POST").catch(() => {});
    };
    beat();
    const interval = setInterval(beat, 8000);
    const release = () => {
      void fetch("/api/lease/" + tab.current, {
        method: "DELETE",
        headers: { "X-CSRF-Token": tokenRef.current },
        keepalive: true,
      });
    };
    const resume = () => beat();
    window.addEventListener("pagehide", release);
    window.addEventListener("pageshow", resume);
    return () => {
      clearInterval(interval);
      release();
      window.removeEventListener("pagehide", release);
      window.removeEventListener("pageshow", resume);
    };
  }, [csrf]);
  useEffect(() => {
    if (page === "terminal")
      terminalEnd.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
  }, [logs.length, page]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setHelp(false);
        setMobile(false);
        setNotifications(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => {
    setReply("");
  }, [state?.prompt?.prompt_id]);
  useEffect(() => {
    const suggestion = state?.prompt?.suggested_value;
    if (state?.prompt?.kind === "captcha" && suggestion) {
      setReply(current => current || suggestion);
    }
  }, [state?.prompt?.prompt_id, state?.prompt?.suggested_value]);
  useEffect(() => {
    setOcrStatus(null);
  }, [profileId]);
  useEffect(() => {
    if (!help && !state?.prompt) return;
    const previous = document.activeElement as HTMLElement | null;
    const modal = document.querySelector<HTMLElement>('[role="dialog"]');
    if (!modal) return;
    const elements = () =>
      Array.from(
        modal?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), a[href], select, textarea",
        ) || [],
      );
    elements()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const list = elements();
      if (!list.length) return;
      const first = list[0],
        last = list[list.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      if (previous?.isConnected) previous.focus();
    };
  }, [help, page, state?.prompt?.prompt_id]);
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((s) => (s ? { ...s, [key]: value } : s));
    setDirty(true);
    dirtyRef.current = true;
  };
  const save = async () => {
    if (!settings) return;
    await api("/profiles/" + profileId + "/settings", "PUT", settings);
    setDirty(false);
    dirtyRef.current = false;
    await refresh();
  };
  const confirmPrompt = () =>
    act(async () => {
      if (!state?.prompt) return;
      const prompt = state.prompt;
      await api("/prompt", "POST", {
        prompt_id: prompt.prompt_id,
        value: reply.trim(),
      });
      if (prompt.kind === "otp") setAuthCodeSubmitted(true);
      setReply("");
      await refresh();
    });
  const start = (operation: string, resumeId = "") =>
    act(async () => {
      const version = stopVersion.current;
      await save();
      if (version !== stopVersion.current) return;
      await api("/profiles/" + profileId + "/jobs", "POST", {
        operation,
        resume_id: resumeId,
      });
      if (version !== stopVersion.current) {
        await api("/jobs/stop", "POST");
        return;
      }
      await refresh();
      notify(
        operation === "demo"
          ? "Запущена демонстрация без запросов к hh.ru"
          : "Задача запущена",
      );
    });
  const stop = async (emergency = false) => {
    stopVersion.current++;
    try {
      await api("/jobs/" + (emergency ? "emergency-stop" : "stop"), "POST");
      await refresh();
      notify(
        emergency
          ? "Все задачи и расписания остановлены"
          : "Задача остановлена",
      );
    } catch (error) {
      notify((error as Error).message, true);
    }
  };
  const schedule = (operation: string, enabled: boolean, hours = 4) =>
    act(async () => {
      const version = stopVersion.current;
      await save();
      if (version !== stopVersion.current) return;
      await api("/profiles/" + profileId + "/schedule", "PUT", {
        operation,
        enabled,
        hours,
      });
      if (version !== stopVersion.current) {
        await api("/jobs/emergency-stop", "POST");
        return;
      }
      await refresh();
      notify(enabled ? "Расписание включено" : "Расписание выключено");
    });
  const download = (text: string, name: string, type = "text/plain") => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };
  const exportHistory = () => {
    if (!state) return;
    const q = (s: string) =>
      '"' + (/^[=+\-@\t\r]/.test(s) ? "'" : "") + s.replaceAll('"', '""') + '"';
    download(
      "\ufeffДата,Вакансия,Компания,Ссылка,Статус\n" +
        state.history
          .map((e) =>
            [e.at, e.title, e.company, e.url, e.status].map(q).join(","),
          )
          .join("\n"),
      "hh-history.csv",
      "text/csv;charset=utf-8",
    );
  };
  const toggleDry = () =>
    act(async () => {
      if (!settings) return;
      const next = { ...settings, dry_run: !settings.dry_run };
      await api("/profiles/" + profileId + "/settings", "PUT", next);
      setSettings(next);
      setDirty(false);
      dirtyRef.current = false;
      await refresh();
      notify(
        next.dry_run
          ? "Тестовый режим включён"
          : "Реальный режим: отклики будут отправляться на hh.ru",
      );
    });

  if (error && !state)
    return (
      <div className="boot">
        <Unplug size={32} />
        <h1>Не удалось открыть панель</h1>
        <p>{error}</p>
        <button className="button primary" onClick={() => location.reload()}>
          Повторить
        </button>
      </div>
    );
  if (loading || !state || !settings)
    return (
      <div className="boot">
        <div className="brand-icon">
          hh
          <span />
        </div>
        <Loader2 className="spin" />
        <p>Открываем ваше рабочее пространство…</p>
      </div>
    );
  const s = settings,
    p = state.profile,
    running = Boolean(state.active),
    job = state.jobs[0],
    bumpSchedule = state.schedules.find((x) => x.operation === "bump"),
    applySchedule = state.schedules.find((x) => x.operation === "apply");
  const currentProfileRunning = state.active?.profile_id === profileId;
  const providerInfo = AI_PROVIDERS[s.provider];
  const authActive =
    currentProfileRunning && state.active?.operation === "auth";
  const authPrompt = authActive ? state.prompt : null;
  const lastAuth = state.jobs.find((entry) => entry.operation === "auth");
  const authStep = authActive
    ? authPrompt?.kind === "otp" || authCodeSubmitted
      ? 2
      : 1
    : state.has_token
      ? 3
      : 1;
  const ratio = Math.min(100, (state.stats.sent_24h / s.daily_limit) * 100);
  const filteredLogs = logs.filter(
    (l) =>
      (level === "ALL" || l.level === level) &&
      l.message.toLowerCase().includes(logSearch.toLowerCase()),
  );
  const filteredHistory = state.history.filter(
    (e) =>
      (historyFilter === "all" || e.status === historyFilter) &&
      (e.title + " " + e.company)
        .toLowerCase()
        .includes(historySearch.toLowerCase()),
  );
  const fields = (compact = false) => (
    <>
      <label className="field full">
        <span>Кого вы ищете?</span>
        <div className="input-icon">
          <Search size={17} />
          <input
            value={s.text}
            onChange={(e) => update("text", e.target.value)}
            placeholder="Например, Python developer"
            maxLength={500}
          />
          {!compact && (
            <button
              className="syntax"
              onClick={() => setSyntax(!syntax)}
              type="button"
            >
              <Code2 size={15} /> Синтаксис
            </button>
          )}
        </div>
      </label>
      {syntax && !compact && (
        <div className="info full">
          <Code2 size={17} />
          <span>
            Поиск по названию: <code>NAME:(Python AND developer)</code>. Точное
            совпадение — в кавычках; исключение — <code>NOT Junior</code>.
          </span>
        </div>
      )}
      <label className="field">
        <span>Регион</span>
        <select
          value={["", "1", "2", "113"].includes(s.area) ? s.area : "custom"}
          onChange={(e) =>
            update("area", e.target.value === "custom" ? "0" : e.target.value)
          }
        >
          <option value="">Все регионы</option>
          <option value="1">Москва</option>
          <option value="2">Санкт-Петербург</option>
          <option value="113">Россия</option>
          <option value="custom">Другой регион (ID)</option>
        </select>
      </label>
      {!["", "1", "2", "113"].includes(s.area) && (
        <label className="field">
          <span>ID региона hh.ru</span>
          <input
            inputMode="numeric"
            value={s.area}
            onChange={(e) => update("area", e.target.value.replace(/\D/g, ""))}
          />
        </label>
      )}
      <label className="field">
        <span>
          Зарплата от, ₽ <em>необязательно</em>
        </span>
        <input
          type="number"
          min="0"
          max="10000000"
          value={s.salary || ""}
          onChange={(e) => update("salary", +e.target.value)}
          placeholder="Любая зарплата"
        />
      </label>
      <label className="field">
        <span>Опыт работы</span>
        <select
          value={s.experience}
          onChange={(e) => update("experience", e.target.value)}
        >
          <option value="">Любой опыт</option>
          <option value="noExperience">Нет опыта</option>
          <option value="between1And3">От 1 до 3 лет</option>
          <option value="between3And6">От 3 до 6 лет</option>
          <option value="moreThan6">Более 6 лет</option>
        </select>
      </label>
      <label className="field">
        <span>График работы</span>
        <select
          value={s.schedule}
          onChange={(e) => update("schedule", e.target.value)}
        >
          <option value="">Любой график</option>
          <option value="remote">Удалённая работа</option>
          <option value="fullDay">Полный день</option>
          <option value="flexible">Гибкий график</option>
          <option value="shift">Сменный график</option>
          <option value="flyInFlyOut">Вахта</option>
        </select>
      </label>
    </>
  );
  const logView = (mini = false) => (
    <div
      className={"console " + (mini ? "mini-console" : "")}
      role="log"
      aria-label="Журнал задач"
      aria-live="polite"
    >
      {filteredLogs.length ? (
        filteredLogs.slice(mini ? -5 : -150).map((log) => (
          <div
            className={"log-line log-" + log.level.toLowerCase()}
            key={log.id}
          >
            <time>
              {date(log.at, {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </time>
            <span className="log-level">{log.level}</span>
            <span>{log.message}</span>
          </div>
        ))
      ) : (
        <div className="console-empty">
          <span className="terminal-prompt">❯</span>
          <div>
            Ожидание первого запуска
            <span>Здесь появятся события вашей задачи.</span>
          </div>
          <i className="cursor" />
        </div>
      )}
      <div ref={mini ? undefined : terminalEnd} />
    </div>
  );
  const confirmationForm = (prompt: InputPrompt) => (
    <ConfirmationForm
      key={prompt.prompt_id}
      prompt={prompt}
      value={reply}
      pending={pending}
      onChange={setReply}
      onSubmit={confirmPrompt}
      onCancel={() => void stop()}
      onCancelRecognition={() => act(async () => {
        await api("/prompt/ocr/cancel", "POST", { prompt_id: prompt.prompt_id });
        await refresh();
      })}
      onRetryRecognition={() => act(async () => {
        setReply("");
        await api("/prompt/ocr/retry", "POST", { prompt_id: prompt.prompt_id });
        await refresh();
      })}
    />
  );
  const runButton = (wide = false) => (
    <button
      disabled={pending || running}
      className={"button primary " + (wide ? "wide" : "")}
      onClick={() => start("apply")}
    >
      {pending ? (
        <Loader2 className="spin" size={17} />
      ) : (
        <Play size={16} fill="currentColor" />
      )}
      {s.dry_run ? "Запустить тестовый поиск" : "Запустить автоотклики"}
      <ArrowRight size={17} />
    </button>
  );

  return (
    <div className="app-shell">
      {mobile && (
        <div className="sidebar-scrim" onClick={() => setMobile(false)} />
      )}
      <aside className={"sidebar " + (mobile ? "mobile-open" : "")}>
        <a className="brand" href="#overview" onClick={() => go("overview")}>
          <div className="brand-icon">
            hh
            <span />
          </div>
          <div>
            HH Studio<span>Ваш карьерный ассистент</span>
          </div>
        </a>
        <button className="workspace-select" onClick={() => go("accounts")}>
          <div className="workspace-avatar">{p.name[0]}</div>
          <div>
            <strong>{p.name}</strong>
            <span>Личное пространство</span>
          </div>
          <ChevronDown size={15} />
        </button>
        <div className="nav-caption">РАБОЧЕЕ ПРОСТРАНСТВО</div>
        <nav>
          {navigation.map(({ id, label, icon: Icon, badge }) => (
            <button
              key={id}
              onClick={() => go(id)}
              className={"nav-item " + (page === id ? "active" : "")}
            >
              <Icon size={19} />
              <span>{label}</span>
              {badge && <b className="ai-badge">{badge}</b>}
              {id === "terminal" && running && <i className="green-dot" />}
            </button>
          ))}
        </nav>
        <div className="nav-caption secondary-caption">УПРАВЛЕНИЕ</div>
        <nav>
          <button
            className={"nav-item " + (page === "accounts" ? "active" : "")}
            onClick={() => go("accounts")}
          >
            <Users size={19} />
            <span>Аккаунты</span>
          </button>
          <button
            className={"nav-item " + (page === "settings" ? "active" : "")}
            onClick={() => go("settings")}
          >
            <Settings2 size={19} />
            <span>Настройки</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-card">
            <ShieldCheck size={21} />
            <strong>Всё остаётся у вас</strong>
            <p>
              Ключи и данные хранятся
              <br />
              только на этом компьютере.
            </p>
            <button onClick={() => setHelp(true)}>
              О безопасности <ArrowUpRight size={13} />
            </button>
          </div>
          <button className="sidebar-profile" onClick={() => go("accounts")}>
            <div className="user-avatar">{p.account?.name?.[0] || "В"}</div>
            <div>
              <strong>{p.account?.name || "Ваш аккаунт"}</strong>
              <span>
                <i className={state.has_token ? "green-dot" : "gray-dot"} />
                {state.has_token ? "Подключён к hh.ru" : "Не подключён"}
              </span>
            </div>
            <MoreHorizontal size={18} />
          </button>
          <div className="app-version">
            HH Studio{" "}
            <span>
              v1.0.0 <i>•</i> Local
            </span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="mobile-menu icon-button"
              onClick={() => setMobile(true)}
              aria-label="Открыть меню"
            >
              <Menu size={20} />
            </button>
            <span>Рабочее пространство</span>
            <ChevronRight size={14} />
            <strong>{pageNames[page]}</strong>
          </div>
          <div className="topbar-actions">
            <span
              className={"connection-pill " + (!connected ? "offline" : "")}
            >
              <i />
              {connected ? "Локальное подключение" : "Переподключение…"}
            </span>
            <span className="topbar-divider" />
            <button
              className="icon-button"
              aria-label="Переключить тему"
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            >
              {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
            </button>
            <div className="notifications-wrap">
              <button
                className="icon-button"
                aria-label="Уведомления"
                onClick={() => setNotifications(!notifications)}
              >
                <Bell size={18} />
                {state.prompt && <i className="notification-dot" />}
              </button>
              {notifications && (
                <div className="notification-popover">
                  <strong>Уведомления</strong>
                  <p>
                    {state.prompt
                      ? "Задача ожидает ввода. Проверьте окно подтверждения."
                      : job
                        ? `${statusNames[job.status]}: ${date(job.started_at)}`
                        : "Новых уведомлений пока нет"}
                  </p>
                  <small>События задач появятся здесь.</small>
                </div>
              )}
            </div>
            <button
              className="top-avatar"
              onClick={() => go("accounts")}
              aria-label="Открыть аккаунт"
            >
              {p.account?.name?.[0] || "В"}
            </button>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {page === "overview"
                  ? new Date().toLocaleDateString("ru-RU", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                    })
                  : "HH STUDIO / " + pageNames[page].toUpperCase()}
              </div>
              <h1>
                {page === "overview"
                  ? "Поиск под вашим контролем"
                  : pageNames[page]}
              </h1>
              <p>
                {
                  {
                    overview:
                      "Освободите время для того, что действительно важно.",
                    apply:
                      "Настройте поиск один раз. Остальное возьмём на себя.",
                    letters:
                      "Хорошее первое впечатление начинается с нескольких строк.",
                    resumes: "Оставайтесь заметными для будущего работодателя.",
                    history: "Каждый шаг к новой работе — в одном месте.",
                    terminal: "Наблюдайте за процессом в реальном времени.",
                    accounts: "Подключите hh.ru и управляйте своими профилями.",
                    settings:
                      "Ваш темп. Ваши правила. Ваше рабочее пространство.",
                  }[page]
                }
              </p>
            </div>
            <div className="heading-actions">
              {page === "overview" || page === "apply" ? (
                <>
                  <button
                    className={
                      "dry-indicator " + (!s.dry_run ? "live-mode" : "")
                    }
                    onClick={toggleDry}
                    disabled={pending || running}
                  >
                    <ShieldCheck size={16} />
                    {s.dry_run ? "Тестовый режим" : "Реальная отправка"}
                    <Switch checked={s.dry_run} />
                  </button>
                  <button
                    className="button danger-outline"
                    onClick={() => stop(true)}
                    title="Остановить задачи и отключить все расписания"
                  >
                    <Square size={13} /> Стоп всё
                  </button>
                </>
              ) : page === "history" ? (
                <button
                  className="button"
                  disabled={!state.history.length}
                  onClick={exportHistory}
                >
                  <ArrowDownToLine size={16} /> Экспорт CSV
                </button>
              ) : page === "resumes" ? (
                <button
                  className="button"
                  disabled={pending || running}
                  onClick={() => start("sync")}
                >
                  <RefreshCw size={16} /> Обновить список
                </button>
              ) : null}
            </div>
          </div>

          {state.active && (
            <div className="running-banner">
              <Activity size={18} className="pulse" />
              <div>
                <strong>
                  {currentProfileRunning
                    ? "Задача выполняется"
                    : "Выполняется задача другого профиля"}
                </strong>
                <span>
                  {state.prompt
                    ? "Нужно подтверждение"
                    : state.wait_seconds
                      ? `Следующий отклик через ${state.wait_seconds} с`
                      : `${state.active.operation} · ${currentProfileRunning ? job?.processed || 0 : "—"} обработано`}
                </span>
              </div>
              <button onClick={() => go("terminal")}>
                Открыть логи <ArrowRight size={15} />
              </button>
              <button
                className="icon-button"
                onClick={() => stop()}
                aria-label="Остановить задачу"
              >
                <Square size={14} />
              </button>
            </div>
          )}

          {page === "overview" && (
            <>
              <section className="hero">
                <div className="hero-copy">
                  <span className="hero-eyebrow">
                    <span /> ВАШ НОВЫЙ ПОДХОД К ПОИСКУ
                  </span>
                  <h2>
                    Меньше рутины.
                    <br />
                    Больше возможностей.
                  </h2>
                  <p>
                    Автоотклики, письма с ИИ и обновление резюме.
                    <br />
                    Сосредоточьтесь на следующем шаге в карьере.
                  </p>
                  <div className="hero-buttons">
                    <button
                      className="button hero-button"
                      onClick={() => go(state.has_token ? "apply" : "accounts")}
                    >
                      {state.has_token ? "Настроить поиск" : "Подключить hh.ru"}
                      <ArrowUpRight size={17} />
                    </button>
                    <button className="hero-link" onClick={() => setHelp(true)}>
                      <CircleHelp size={16} /> Как это работает
                    </button>
                  </div>
                </div>
                <div className="hero-art" aria-hidden="true">
                  <div className="orbit orbit-one" />
                  <div className="orbit orbit-two" />
                  <div className="orbit orbit-three" />
                  <div className="orbit-core">
                    <Send size={32} strokeWidth={1.6} />
                  </div>
                  <div className="float-card float-top">
                    <div className="float-icon">
                      <BriefcaseBusiness size={18} />
                    </div>
                    <div>
                      <strong>Ваша следующая работа</strong>
                      <span>Ближе, чем кажется</span>
                    </div>
                    <Sparkles size={15} />
                  </div>
                  <div className="float-card float-bottom">
                    <div className="float-check">
                      <Check size={15} />
                    </div>
                    <div>
                      <strong>Всё под контролем</strong>
                      <span>Вы выбираете направление</span>
                    </div>
                  </div>
                  <span className="art-spark spark-one">✦</span>
                  <span className="art-spark spark-two">✧</span>
                  <div className="art-dot dot-one" />
                  <div className="art-dot dot-two" />
                </div>
              </section>
              <section className="stats-grid">
                <Stat
                  label="Отклики за 24 часа"
                  value={state.stats.sent_24h.toString()}
                  icon={Send}
                  color="green"
                  footer="Подтверждённые отправки"
                  trend={
                    state.stats.sent_24h > 0 ? "Активный поиск" : undefined
                  }
                />
                <Stat
                  label="Дневной лимит"
                  value={
                    <>
                      {state.stats.sent_24h}
                      <span> / {s.daily_limit}</span>
                    </>
                  }
                  icon={ShieldCheck}
                  color="blue"
                  footer={`${s.daily_limit - state.stats.sent_24h > 0 ? s.daily_limit - state.stats.sent_24h : 0} откликов доступно`}
                  progress={ratio}
                />
                <Stat
                  label="Активные резюме"
                  value={p.resumes
                    .filter((r) => r.status.id === "published")
                    .length.toString()
                    .padStart(2, "0")}
                  icon={FileText}
                  color="violet"
                  footer={
                    p.synced_at
                      ? "Синхронизировано с hh.ru"
                      : "Подключите аккаунт для загрузки"
                  }
                />
                <Stat
                  label="Фоновые задачи"
                  value={String(
                    state.schedules.filter((x) => x.enabled).length +
                      (currentProfileRunning ? 1 : 0),
                  ).padStart(2, "0")}
                  icon={Zap}
                  color="orange"
                  footer={
                    running
                      ? "Есть выполняющаяся задача"
                      : "Всё готово к запуску"
                  }
                  indicator={running}
                />
              </section>
              <div className="dashboard-grid">
                <section className="card quick-search">
                  <div className="card-heading">
                    <div>
                      <h2>
                        <Search size={18} /> Быстрый запуск
                      </h2>
                      <p>Найдём вакансии, которые подходят именно вам</p>
                    </div>
                    <span className="neutral-badge">Новый поиск</span>
                  </div>
                  <div className="form-grid">{fields(true)}</div>
                  <div className="quick-footer">
                    <button className="text-button" onClick={() => go("apply")}>
                      <Settings2 size={15} /> Все фильтры{" "}
                      <ChevronRight size={14} />
                    </button>
                    {runButton()}
                  </div>
                  <div className="safe-footnote">
                    <ShieldCheck size={13} />
                    {s.dry_run
                      ? "Тестовый режим: ни один отклик не будет отправлен"
                      : "Реальный режим: отклики будут отправлены на hh.ru"}
                  </div>
                </section>
                <section className="card system-card">
                  <div className="card-heading">
                    <h2>Статус системы</h2>
                    <span
                      className={
                        "small-pill " + (state.has_token ? "green" : "neutral")
                      }
                    >
                      {state.has_token ? "Готово к работе" : "Настройка"}
                    </span>
                  </div>
                  <button className="system-row" onClick={() => go("accounts")}>
                    <div className="system-icon hh-mini">hh</div>
                    <div>
                      <strong>Аккаунт HeadHunter</strong>
                      <span>
                        {state.has_token
                          ? p.account?.name || "Сессия сохранена"
                          : "Подключите свой аккаунт"}
                      </span>
                    </div>
                    {state.has_token ? (
                      <CheckCircle2 className="green-text" size={18} />
                    ) : (
                      <ChevronRight size={17} />
                    )}
                  </button>
                  <button className="system-row" onClick={() => go("letters")}>
                    <div className="system-icon ai-icon">
                      <Sparkles size={18} />
                    </div>
                    <div>
                      <strong>Сопроводительные письма</strong>
                      <span>
                        {s.letter_mode === "ai"
                          ? p.has_api_key[s.provider]
                            ? "AI-генерация подключена"
                            : "Добавьте API-ключ"
                          : "Статический шаблон"}
                      </span>
                    </div>
                    <ChevronRight size={17} />
                  </button>
                  <button className="system-row" onClick={() => go("resumes")}>
                    <div className="system-icon bump-icon">
                      <RefreshCw size={18} />
                    </div>
                    <div>
                      <strong>Автоподнятие резюме</strong>
                      <span>
                        {bumpSchedule?.enabled
                          ? `Каждые ${bumpSchedule.hours} ч`
                          : "Расписание не настроено"}
                      </span>
                    </div>
                    <ChevronRight size={17} />
                  </button>
                  <div className="tip">
                    <div>
                      <Sparkles size={15} />
                      <strong>Маленький совет</strong>
                    </div>
                    <p>
                      Персональное письмо помогает рассказать, почему вы
                      подходите команде.
                    </p>
                    <button onClick={() => go("letters")}>
                      Настроить письмо <ArrowRight size={14} />
                    </button>
                  </div>
                </section>
                <section className="card activity-card">
                  <div className="card-heading">
                    <div>
                      <h2>Активность откликов</h2>
                      <p>Каждый отклик — шаг навстречу возможностям</p>
                    </div>
                    <div className="segmented small">
                      {[7, 14, 30].map((n) => (
                        <button
                          key={n}
                          onClick={() => setChartDays(n)}
                          className={chartDays === n ? "selected" : ""}
                        >
                          {n} дней
                        </button>
                      ))}
                    </div>
                  </div>
                  <Chart series={state.stats.series} days={chartDays} />
                  <div className="chart-legend">
                    <i /> Отправленные отклики{" "}
                    <span>Без тестовых прогонов</span>
                  </div>
                </section>
                <section className="card recent-card">
                  <div className="card-heading">
                    <h2>
                      <Terminal size={18} /> Журнал событий
                    </h2>
                    <span className="live-badge">
                      <i /> LIVE
                    </span>
                  </div>
                  {logView(true)}
                  <div className="recent-footer">
                    <span>
                      {logs.length ? "Последние события" : "Пока тихо. Начнём?"}
                    </span>
                    <button
                      className="text-button"
                      onClick={() => go("terminal")}
                    >
                      Открыть консоль <ArrowUpRight size={14} />
                    </button>
                  </div>
                </section>
              </div>
            </>
          )}

          {page === "apply" && (
            <div className="editor-layout">
              <div className="editor-main">
                <section className="card">
                  <div className="card-heading">
                    <div>
                      <h2>
                        <Search size={19} /> Конструктор поиска
                      </h2>
                      <p>Точнее запрос — полезнее отклики</p>
                    </div>
                    <span className="step-label">01</span>
                  </div>
                  <div className="form-grid">
                    {fields()}
                    <label className="field full">
                      <span>Резюме для отклика</span>
                      <select
                        value={s.resume_id}
                        onChange={(e) => update("resume_id", e.target.value)}
                      >
                        <option value="">Все опубликованные резюме</option>
                        {p.resumes.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.title}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </section>
                <section className="card">
                  <div className="card-heading">
                    <div>
                      <h2>
                        <ShieldCheck size={19} /> Фильтры и исключения
                      </h2>
                      <p>Не тратьте время на неподходящие предложения</p>
                    </div>
                    <span className="step-label">02</span>
                  </div>
                  <div className="form-grid">
                    <ListField
                      label="Слова в названии или описании"
                      values={s.excluded_words}
                      onChange={(v) => update("excluded_words", v)}
                      placeholder="Junior, стажёр, битрикс, 1С"
                    />
                    <ListField
                      label="Компании, которые нужно исключить"
                      values={s.excluded_companies}
                      onChange={(v) => update("excluded_companies", v)}
                      placeholder="Название компании, другое название"
                    />
                  </div>
                  <div className="subtle-note">
                    Через запятую или с новой строки. Регистр не учитывается.
                    Исключения действуют локально.
                  </div>
                </section>
                <section className="card">
                  <div className="card-heading">
                    <div>
                      <h2>
                        <Clock3 size={19} /> Параметры запуска
                      </h2>
                      <p>Выберите комфортный и осторожный темп</p>
                    </div>
                    <span className="step-label">03</span>
                  </div>
                  <div className="form-grid four">
                    <NumberField
                      label="Задержка от, с"
                      value={s.delay_min}
                      min={10}
                      max={3600}
                      onChange={(v) => update("delay_min", v)}
                    />
                    <NumberField
                      label="Задержка до, с"
                      value={s.delay_max}
                      min={10}
                      max={3600}
                      onChange={(v) => update("delay_max", v)}
                    />
                    <NumberField
                      label="Откликов за запуск"
                      value={s.max_responses}
                      min={1}
                      max={200}
                      onChange={(v) => update("max_responses", v)}
                    />
                    <NumberField
                      label="Страниц поиска"
                      value={s.total_pages}
                      min={1}
                      max={20}
                      onChange={(v) => update("total_pages", v)}
                    />
                  </div>
                  {s.delay_min < 30 && (
                    <div className="warning">
                      <CircleHelp size={18} /> Короткие интервалы повышают риск
                      ограничений. Рекомендуем увеличить паузу до 30–60 секунд.
                    </div>
                  )}
                  <div className="toggle-row">
                    <div>
                      <strong>Тестовый прогон</strong>
                      <span>
                        Проверить подбор вакансий без отправки откликов
                      </span>
                    </div>
                    <button
                      className="switch-button"
                      onClick={() => update("dry_run", !s.dry_run)}
                      role="switch"
                      aria-checked={s.dry_run}
                      aria-label="Тестовый прогон"
                    >
                      <Switch checked={s.dry_run} />
                    </button>
                  </div>
                </section>
              </div>
              <aside className="editor-aside">
                <section className="card launch-summary">
                  <span className="section-kicker">ВАШ СЦЕНАРИЙ</span>
                  <h2>Всё готово к поиску?</h2>
                  <div className="summary-line">
                    <span>Режим</span>
                    <strong className={s.dry_run ? "green-text" : "red-text"}>
                      {s.dry_run ? "Тестовый прогон" : "Реальная отправка"}
                    </strong>
                  </div>
                  <div className="summary-line">
                    <span>Лимит запуска</span>
                    <strong>до {s.max_responses}</strong>
                  </div>
                  <div className="summary-line">
                    <span>Интервал</span>
                    <strong>
                      {s.delay_min}–{s.delay_max} с
                    </strong>
                  </div>
                  <div className="summary-line">
                    <span>Письмо</span>
                    <strong>
                      {s.letter_mode === "ai" ? "С помощью ИИ" : "По шаблону"}
                    </strong>
                  </div>
                  <div className="summary-line">
                    <span>Аккаунт</span>
                    <strong>
                      {state.has_token ? "Подключён" : "Не подключён"}
                    </strong>
                  </div>
                  {!state.has_token && (
                    <button
                      className="info clickable"
                      onClick={() => go("accounts")}
                    >
                      <Unplug size={17} /> Сначала подключите hh.ru{" "}
                      <ArrowRight size={15} />
                    </button>
                  )}
                  {runButton(true)}
                  <button
                    className="button wide"
                    disabled={pending}
                    onClick={() =>
                      act(async () => {
                        await save();
                        notify("Настройки поиска сохранены");
                      })
                    }
                  >
                    <Check size={16} /> Сохранить настройки{" "}
                    {dirty && <i className="unsaved-dot" />}
                  </button>
                  <p className="summary-note">
                    Тестовый прогон обращается к hh.ru и может использовать
                    платный AI, если вы его включили.
                  </p>
                </section>
                <section className="card">
                  <div className="card-heading">
                    <h2>
                      <Clock3 size={17} /> По расписанию
                    </h2>
                  </div>
                  <ScheduleControl
                    operation="apply"
                    schedule={applySchedule}
                    onChange={schedule}
                    disabled={pending}
                  />
                  <p className="subtle-note">
                    Запускается по сохранённым настройкам, пока панель открыта.
                  </p>
                </section>
                <div className="plain-note">
                  <ShieldCheck size={20} />
                  <p>
                    Случайные интервалы помогают снизить нагрузку. Они не
                    гарантируют отсутствие ограничений hh.ru.
                  </p>
                </div>
              </aside>
            </div>
          )}

          {page === "letters" && (
            <div className="editor-layout">
              <div className="editor-main">
                <section className="card">
                  <div className="card-heading">
                    <div>
                      <h2>
                        <Sparkles size={19} /> Как будем писать?
                      </h2>
                      <p>
                        Один шаблон или индивидуальное письмо к каждой вакансии
                      </p>
                    </div>
                  </div>
                  <div className="mode-grid">
                    <button
                      className={
                        "mode-card " +
                        (s.letter_mode === "static" ? "selected" : "")
                      }
                      onClick={() => update("letter_mode", "static")}
                    >
                      <FileText size={22} />
                      <strong>По вашему шаблону</strong>
                      <span>Предсказуемо, быстро и без API-ключа</span>
                      <i>{s.letter_mode === "static" && <Check size={12} />}</i>
                    </button>
                    <button
                      className={
                        "mode-card " +
                        (s.letter_mode === "ai" ? "selected" : "")
                      }
                      onClick={() => update("letter_mode", "ai")}
                    >
                      <Sparkles size={22} />
                      <strong>С помощью ИИ</strong>
                      <span>Личное письмо для каждой вакансии</span>
                      <i>{s.letter_mode === "ai" && <Check size={12} />}</i>
                    </button>
                  </div>
                  {s.letter_mode === "static" ? (
                    <label className="field">
                      <span>Текст сопроводительного письма</span>
                      <textarea
                        rows={9}
                        value={s.cover_letter}
                        onChange={(e) => update("cover_letter", e.target.value)}
                        maxLength={10000}
                      />
                      <small>
                        Переменные: <code>{"{vacancy_name}"}</code> — вакансия,{" "}
                        <code>{"{company_name}"}</code> — компания.
                      </small>
                    </label>
                  ) : (
                    <>
                      <div className="form-grid">
                        <AIProviderFields
                          provider={s.provider}
                          model={s.model}
                          gigachatScope={
                            s.gigachat_scope || "GIGACHAT_API_PERS"
                          }
                          caBundle={s.gigachat_ca_bundle || ""}
                          onProviderChange={(provider) => {
                            update("provider", provider);
                            update(
                              "model",
                              AI_PROVIDERS[provider].defaultModel,
                            );
                            setApiKey("");
                          }}
                          onModelChange={(value) => update("model", value)}
                          onScopeChange={(value) =>
                            update("gigachat_scope", value)
                          }
                          onCaBundleChange={(value) =>
                            update("gigachat_ca_bundle", value)
                          }
                        />
                        <label className="field full">
                          <span>
                            {providerInfo.keyLabel}{" "}
                            <b
                              className={
                                "small-pill " +
                                (p.has_api_key[s.provider]
                                  ? "green"
                                  : "neutral")
                              }
                            >
                              {p.has_api_key[s.provider]
                                ? "Ключ сохранён"
                                : "Не добавлен"}
                            </b>
                          </span>
                          <div className="secret-field">
                            <input
                              type="password"
                              autoComplete="new-password"
                              value={apiKey}
                              onChange={(e) => setApiKey(e.target.value)}
                              placeholder={
                                p.has_api_key[s.provider]
                                  ? "Введите новый ключ для замены"
                                  : "Вставьте " + providerInfo.keyLabel
                              }
                            />
                            <button
                              className="button"
                              disabled={pending || !apiKey.trim()}
                              onClick={() =>
                                act(async () => {
                                  await api(
                                    "/profiles/" + profileId + "/secret",
                                    "PUT",
                                    {
                                      provider: s.provider,
                                      api_key: apiKey.trim(),
                                    },
                                  );
                                  setApiKey("");
                                  await refresh();
                                  notify("API-ключ сохранён локально");
                                })
                              }
                            >
                              Сохранить ключ
                            </button>
                            {p.has_api_key[s.provider] && (
                              <button
                                className="icon-button"
                                aria-label="Удалить API-ключ"
                                onClick={() =>
                                  act(async () => {
                                    await api(
                                      "/profiles/" + profileId + "/secret",
                                      "PUT",
                                      { provider: s.provider, api_key: "" },
                                    );
                                    await refresh();
                                    notify("Ключ удалён");
                                  })
                                }
                              >
                                <Trash2 size={16} />
                              </button>
                            )}
                          </div>
                          <small>{providerInfo.keyHelp}</small>
                        </label>
                        <label className="field full">
                          <span>Системный промпт</span>
                          <textarea
                            rows={4}
                            value={s.system_prompt}
                            onChange={(e) =>
                              update("system_prompt", e.target.value)
                            }
                            maxLength={15000}
                          />
                        </label>
                        <label className="field full">
                          <span>Расскажите о своём опыте</span>
                          <textarea
                            rows={6}
                            placeholder="Ваши навыки, проекты и достижения. ИИ будет опираться на эти факты."
                            value={s.experience_context}
                            onChange={(e) =>
                              update("experience_context", e.target.value)
                            }
                            maxLength={20000}
                          />
                        </label>
                      </div>
                      <div className="info">
                        <ShieldCheck size={18} />
                        <span>
                          При генерации текст вакансии и указанный опыт
                          передаются выбранному AI-провайдеру. Его API
                          тарифицируется отдельно. Доступность модели зависит от
                          вашего аккаунта.
                        </span>
                      </div>
                    </>
                  )}
                  <div className="card-actions">
                    <button
                      className="button primary"
                      disabled={pending}
                      onClick={() =>
                        act(async () => {
                          await save();
                          notify("Настройки письма сохранены");
                        })
                      }
                    >
                      <Check size={17} /> Сохранить письмо
                    </button>
                    <button
                      className="button"
                      disabled={pending || running}
                      onClick={() =>
                        act(async () => {
                          const version = stopVersion.current;
                          await save();
                          if (version !== stopVersion.current) return;
                          await api(
                            "/profiles/" + profileId + "/letter",
                            "POST",
                          );
                          if (version !== stopVersion.current) {
                            await api("/jobs/stop", "POST");
                            return;
                          }
                          notify("Готовим пример письма");
                        })
                      }
                    >
                      <Sparkles size={17} /> Создать пример
                    </button>
                  </div>
                </section>
              </div>
              <aside className="editor-aside">
                <section className="card letter-preview">
                  <span className="section-kicker">ПЕРВОЕ ВПЕЧАТЛЕНИЕ</span>
                  <div className="letter-icon">
                    <FileText size={25} />
                    <Sparkles size={14} />
                  </div>
                  <h2>
                    Ваш голос.
                    <br />
                    Ваши возможности.
                  </h2>
                  <p>
                    Короткое, честное письмо работает лучше общих фраз.
                    Расскажите о пользе, которую можете принести.
                  </p>
                  <div className="letter-paper">
                    {state.letter_preview ||
                      "Нажмите «Создать пример», чтобы увидеть письмо для поисковой фразы. Перед отправкой проверьте шаблон и факты."}
                  </div>
                  {state.letter_preview && (
                    <button
                      className="text-button"
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(state.letter_preview || "")
                          .then(() => notify("Текст скопирован"))
                          .catch(() =>
                            notify("Не удалось скопировать текст", true),
                          );
                      }}
                    >
                      <Copy size={14} /> Скопировать текст
                    </button>
                  )}
                  <small>Пример не отправляется работодателю.</small>
                </section>
              </aside>
            </div>
          )}

          {page === "resumes" && (
            <>
              <div className="info">
                <RefreshCw size={18} />
                <span>
                  Резюме загружаются из вашего аккаунта hh.ru. Поднять можно
                  только резюме, для которого hh.ru разрешает обновление.
                </span>
              </div>
              <div className="resume-grid">
                {p.resumes.length ? (
                  p.resumes.map((r) => (
                    <section className="card resume-card" key={r.id}>
                      <div className="resume-card-top">
                        <div className="document-icon">
                          <FileText size={25} />
                        </div>
                        <span
                          className={
                            "small-pill " +
                            (r.status.id === "published" ? "green" : "neutral")
                          }
                        >
                          {r.status.name || r.status.id}
                        </span>
                      </div>
                      <h2>{r.title}</h2>
                      <p>
                        <Clock3 size={14} /> Обновлено: {date(r.updated_at)}
                      </p>
                      <div className="resume-card-actions">
                        <button
                          className="button primary"
                          disabled={pending || running || !r.can_update}
                          onClick={() => start("bump", r.id)}
                        >
                          <ArrowUpRight size={16} />{" "}
                          {r.can_update
                            ? "Поднять в поиске"
                            : "Поднятие недоступно"}
                        </button>
                        <a
                          className="icon-button"
                          href={safeUrl(r.url)}
                          target="_blank"
                          rel="noreferrer"
                          aria-label="Открыть резюме на hh.ru"
                        >
                          <ArrowUpRight size={18} />
                        </a>
                      </div>
                    </section>
                  ))
                ) : (
                  <EmptyState
                    icon={FileText}
                    title="Ваши резюме появятся здесь"
                    text="Подключите аккаунт hh.ru, чтобы загрузить резюме и настроить автоматическое поднятие."
                    button={
                      state.has_token
                        ? "Загрузить резюме"
                        : "Подключить аккаунт"
                    }
                    onClick={() =>
                      state.has_token ? start("sync") : go("accounts")
                    }
                  />
                )}
              </div>
              <section className="card schedule-card">
                <div className="schedule-illustration">
                  <RefreshCw size={28} />
                </div>
                <div className="schedule-description">
                  <h2>Пусть ваше резюме будет на виду</h2>
                  <p>
                    Обновляйте резюме автоматически. Следующий запуск:{" "}
                    {bumpSchedule?.enabled
                      ? date(bumpSchedule.next_run)
                      : "расписание выключено"}
                    .
                  </p>
                  <small>
                    hh.ru определяет доступность поднятия для каждого резюме.
                  </small>
                </div>
                <ScheduleControl
                  operation="bump"
                  schedule={bumpSchedule}
                  onChange={schedule}
                  disabled={pending}
                />
              </section>
            </>
          )}

          {page === "history" && (
            <section className="card history-card">
              <div className="table-toolbar">
                <div className="input-icon">
                  <Search size={17} />
                  <input
                    aria-label="Поиск по истории"
                    placeholder="Вакансия или компания"
                    value={historySearch}
                    onChange={(e) => {
                      setHistorySearch(e.target.value);
                      setHistoryPage(0);
                    }}
                  />
                </div>
                <select
                  aria-label="Статус отклика"
                  value={historyFilter}
                  onChange={(e) => {
                    setHistoryFilter(e.target.value);
                    setHistoryPage(0);
                  }}
                >
                  <option value="all">Все статусы</option>
                  <option value="sent">Отправлено</option>
                  <option value="dry_run">Тестовый прогон</option>
                </select>
                <span>{filteredHistory.length} записей</span>
              </div>
              {filteredHistory.length ? (
                <>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>ВАКАНСИЯ</th>
                          <th>КОМПАНИЯ</th>
                          <th>ДАТА</th>
                          <th>СТАТУС</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {filteredHistory
                          .slice(historyPage * 12, historyPage * 12 + 12)
                          .map((e) => (
                            <tr key={e.id}>
                              <td>
                                <strong>{e.title}</strong>
                              </td>
                              <td>{e.company}</td>
                              <td className="nowrap">{date(e.at)}</td>
                              <td>
                                <span
                                  className={
                                    "small-pill " +
                                    (e.status === "sent" ? "green" : "blue")
                                  }
                                >
                                  {e.status === "sent"
                                    ? "Отправлено"
                                    : "Тестовый прогон"}
                                </span>
                              </td>
                              <td>
                                <a
                                  href={safeUrl(e.url)}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="icon-button"
                                  aria-label="Открыть вакансию"
                                >
                                  <ArrowUpRight size={17} />
                                </a>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="pagination">
                    <span>
                      Показано {historyPage * 12 + 1}–
                      {Math.min(historyPage * 12 + 12, filteredHistory.length)}{" "}
                      из {filteredHistory.length}
                    </span>
                    <button
                      className="icon-button"
                      disabled={historyPage === 0}
                      onClick={() => setHistoryPage((x) => x - 1)}
                      aria-label="Предыдущая страница"
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <span>{historyPage + 1}</span>
                    <button
                      className="icon-button"
                      disabled={
                        (historyPage + 1) * 12 >= filteredHistory.length
                      }
                      onClick={() => setHistoryPage((x) => x + 1)}
                      aria-label="Следующая страница"
                    >
                      <ChevronRight size={18} />
                    </button>
                  </div>
                </>
              ) : (
                <EmptyState
                  icon={History}
                  title={
                    historySearch
                      ? "Ничего не найдено"
                      : "Здесь начнётся ваша история"
                  }
                  text={
                    historySearch
                      ? "Попробуйте другое название вакансии или компании."
                      : "После первого запуска здесь появятся вакансии, компании и результат каждого отклика."
                  }
                  button={
                    historySearch ? "Сбросить поиск" : "Настроить автоотклики"
                  }
                  onClick={() =>
                    historySearch ? setHistorySearch("") : go("apply")
                  }
                />
              )}
              <div className="subtle-note table-note">
                Показаны последние 500 записей этого профиля. «Отправлено»
                записывается только после подтверждения hh.ru.
              </div>
            </section>
          )}

          {page === "terminal" && (
            <>
              <section className="card terminal-card">
                <div className="terminal-toolbar">
                  <div className="terminal-title">
                    <div className="terminal-dots">
                      <i />
                      <i />
                      <i />
                    </div>
                    <span>hh-studio / {p.name}</span>
                  </div>
                  <span className="live-badge">
                    <i /> {connected ? "LIVE" : "OFFLINE"}
                  </span>
                </div>
                <div className="console-controls">
                  <div className="input-icon">
                    <Search size={16} />
                    <input
                      placeholder="Поиск по логу"
                      aria-label="Поиск по логу"
                      value={logSearch}
                      onChange={(e) => setLogSearch(e.target.value)}
                    />
                  </div>
                  <select
                    aria-label="Уровень лога"
                    value={level}
                    onChange={(e) => setLevel(e.target.value)}
                  >
                    <option value="ALL">Все уровни</option>
                    <option value="INFO">INFO</option>
                    <option value="WARNING">WARNING</option>
                    <option value="ERROR">ERROR</option>
                  </select>
                  <button
                    className="icon-button"
                    title="Скачать лог"
                    onClick={() =>
                      act(async () => {
                        const response = await fetch(
                          `/api/profiles/${profileId}/logs?download=true`,
                        );
                        if (!response.ok)
                          throw new Error("Не удалось скачать лог");
                        download(await response.text(), "hh-studio.log");
                      })
                    }
                  >
                    <ArrowDownToLine size={17} />
                  </button>
                  <button
                    className="icon-button"
                    title="Очистить лог"
                    onClick={() =>
                      act(async () => {
                        await api("/profiles/" + profileId + "/logs", "DELETE");
                        setLogs([]);
                        notify("Лог очищен");
                      })
                    }
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
                {logView()}
                <div className="console-status">
                  <span>
                    <i className={running ? "green-dot" : "gray-dot"} />
                    {running ? "Процесс активен" : "Процесс не запущен"}
                  </span>
                  <span>{filteredLogs.length} событий</span>
                  {running ? (
                    <button
                      className="text-button red-text"
                      disabled={pending}
                      onClick={() => stop()}
                    >
                      <Square size={13} /> Остановить
                    </button>
                  ) : (
                    <button
                      className="text-button"
                      disabled={pending}
                      onClick={() => start("demo")}
                    >
                      <Play size={13} /> Проверить на демо
                    </button>
                  )}
                </div>
              </section>
              <div className="two-columns">
                <section className="card">
                  <h2>Что происходит в процессе</h2>
                  <p className="body-copy">
                    Консоль показывает найденные вакансии, решения фильтров,
                    ошибки и паузы. Сообщения выводятся как безопасный текст;
                    ANSI-коды преобразуются в уровни и цвет.
                  </p>
                </section>
                <section className="card">
                  <h2>
                    <ShieldCheck size={18} /> Контроль у вас
                  </h2>
                  <p className="body-copy">
                    При закрытии последней вкладки активная задача
                    останавливается. При потере связи — в течение 25 секунд.
                    «Стоп всё» также отключает расписания.
                  </p>
                </section>
              </div>
              <section className="card">
                <div className="card-heading">
                  <h2>Последние запуски</h2>
                </div>
                {state.jobs.length ? (
                  <div className="job-list">
                    {state.jobs.map((j) => (
                      <div key={j.id}>
                        <div className="job-icon">
                          <Terminal size={17} />
                        </div>
                        <div>
                          <strong>{j.operation}</strong>
                          <span>{date(j.started_at)}</span>
                        </div>
                        <span>
                          {j.processed} обработано · {j.sent} отправлено
                        </span>
                        <span
                          className={
                            "small-pill " +
                            (j.status === "failed"
                              ? "red"
                              : j.status === "completed"
                                ? "green"
                                : "neutral")
                          }
                        >
                          {statusNames[j.status]}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="body-copy">
                    Здесь появятся результаты ваших задач.
                  </p>
                )}
              </section>
            </>
          )}

          {page === "accounts" && (
            <div className="editor-layout">
              <div className="editor-main">
                <section className="card">
                  <div className="card-heading">
                    <div>
                      <h2>
                        <Users size={19} /> Ваши профили
                      </h2>
                      <p>Настройки и сессии каждого аккаунта изолированы</p>
                    </div>
                    <button
                      className="button"
                      onClick={() => setNewProfile(!newProfile)}
                    >
                      <Plus size={16} /> Добавить
                    </button>
                  </div>
                  {newProfile && (
                    <form
                      className="new-profile-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void act(async () => {
                          if (dirty) await save();
                          const created = await api("/profiles", "POST", {
                            name: newName.trim(),
                          });
                          setProfileId(created.id);
                          setNewName("");
                          setNewProfile(false);
                          notify("Профиль создан");
                        });
                      }}
                    >
                      <input
                        aria-label="Название нового профиля"
                        placeholder="Название нового профиля"
                        required
                        maxLength={60}
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                      />
                      <button className="button primary" disabled={pending}>
                        Создать
                      </button>
                    </form>
                  )}
                  <div className="profile-list">
                    {state.profiles.map((profile) => (
                      <button
                        key={profile.id}
                        className={profile.id === profileId ? "selected" : ""}
                        onClick={() => {
                          if (profile.id !== profileId)
                            void act(async () => {
                              if (dirty) await save();
                              setProfileId(profile.id);
                            });
                        }}
                      >
                        <div className="workspace-avatar">
                          {profile.name[0]}
                        </div>
                        <div>
                          <strong>{profile.name}</strong>
                          <span>
                            {profile.id === profileId
                              ? state.has_token
                                ? "Сессия hh.ru сохранена"
                                : "Аккаунт не подключён"
                              : "Переключиться на профиль"}
                          </span>
                        </div>
                        {profile.id === profileId ? (
                          <CheckCircle2 size={19} className="green-text" />
                        ) : (
                          <ChevronRight size={18} />
                        )}
                      </button>
                    ))}
                  </div>
                </section>
                <section className="card">
                  <div className="card-heading">
                    <div>
                      <h2>
                        <div className="hh-tiny">hh</div>{" "}
                        {state.has_token
                          ? "Подключение HeadHunter"
                          : "Подключите HeadHunter"}
                      </h2>
                      <p>Войдите по телефону или email с одноразовым кодом</p>
                    </div>
                  </div>
                  <div className="auth-steps">
                    <span
                      className={authStep === 1 ? "current" : "done"}
                      aria-current={authStep === 1 ? "step" : undefined}
                    >
                      1 <strong>Телефон / email</strong>
                    </span>
                    <i />
                    <span
                      className={
                        authStep === 2 ? "current" : authStep > 2 ? "done" : ""
                      }
                      aria-current={authStep === 2 ? "step" : undefined}
                    >
                      2 <strong>Подтверждение</strong>
                    </span>
                    <i />
                    <span
                      className={authStep === 3 ? "current" : ""}
                      aria-current={authStep === 3 ? "step" : undefined}
                    >
                      3 <strong>Готово</strong>
                    </span>
                  </div>
                  {state.has_token && (
                    <div className="info">
                      <CheckCircle2 size={19} />
                      <div>
                        <strong>{p.account?.name || "Сессия сохранена"}</strong>
                        <p>
                          Последняя проверка: {date(p.synced_at)}. Проверить и
                          обновить сессию можно кнопкой ниже.
                        </p>
                      </div>
                    </div>
                  )}
                  {!authActive && lastAuth?.status === "failed" && (
                    <div className="warning auth-error" role="alert">
                      <CircleHelp size={18} />
                      <div>
                        <strong>Не удалось завершить вход</strong>
                        <p>Запросите новый код и повторите подтверждение.</p>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => go("terminal")}
                      >
                        Открыть логи <ArrowRight size={14} />
                      </button>
                    </div>
                  )}
                  {authActive ? (
                    authPrompt ? (
                      <section
                        className="auth-confirmation"
                        aria-label="Подтверждение входа в hh.ru"
                      >
                        <h2>
                          {authPrompt.kind === "captcha"
                            ? "Проверка безопасности"
                            : "Введите полученный код"}
                        </h2>
                        {confirmationForm(authPrompt)}
                      </section>
                    ) : (
                      <div className="auth-progress" role="status">
                        <Loader2 className="spin" size={20} />
                        <div>
                          <strong>
                            {authCodeSubmitted
                              ? "Проверяем код…"
                              : "Запрашиваем код у hh.ru…"}
                          </strong>
                          <p>
                            {authCodeSubmitted
                              ? "Дождитесь подтверждения входа."
                              : "Поле ввода появится здесь, как только hh.ru запросит подтверждение."}
                          </p>
                        </div>
                        <button
                          className="text-button"
                          onClick={() => void stop()}
                        >
                          Отменить
                        </button>
                      </div>
                    )
                  ) : (
                    <form
                      className="auth-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void act(async () => {
                          const version = stopVersion.current;
                          setAuthCodeSubmitted(false);
                          setReply("");
                          await api(
                            "/profiles/" + profileId + "/auth",
                            "POST",
                            {
                              username: username.trim(),
                            },
                          );
                          if (version !== stopVersion.current) {
                            await api("/jobs/stop", "POST");
                            return;
                          }
                          setUsername("");
                          await refresh();
                          notify("Авторизация начата. Ожидайте запрос кода.");
                        });
                      }}
                    >
                      <label className="field">
                        <span>Телефон или email</span>
                        <input
                          autoComplete="username"
                          placeholder="+7 999 123-45-67 или you@example.com"
                          required
                          minLength={3}
                          maxLength={150}
                          value={username}
                          onChange={(e) => setUsername(e.target.value)}
                        />
                      </label>
                      <button
                        className="button primary"
                        disabled={pending || running}
                      >
                        {pending ? (
                          <Loader2 className="spin" size={17} />
                        ) : (
                          <ArrowRight size={17} />
                        )}{" "}
                        Получить код
                      </button>
                    </form>
                  )}
                  <p className="subtle-note">
                    Код придёт по SMS или email. Введите его в поле
                    подтверждения прямо на этой странице. Капча также появится
                    здесь. Пароль не требуется.
                  </p>
                  {state.has_token && (
                    <button
                      className="button"
                      disabled={pending || running}
                      onClick={() => start("sync")}
                    >
                      <RefreshCw size={16} /> Проверить подключение
                    </button>
                  )}
                </section>
              </div>
              <aside className="editor-aside">
                <section className="card auth-info">
                  <div className="shield-art">
                    <ShieldCheck size={36} />
                  </div>
                  <h2>Личное значит личное</h2>
                  <p>
                    Токены и cookies hh.ru сохраняются на вашем компьютере. Они
                    не отправляются на серверы HH Studio.
                  </p>
                  <div>
                    <Check size={16} /> Вход без передачи пароля
                  </div>
                  <div>
                    <Check size={16} /> Отдельная сессия для профиля
                  </div>
                  <div>
                    <Check size={16} /> Ручной ввод капчи в браузере
                  </div>
                  <small>
                    Ключи сервисов распознавания капчи не нужны: текущий адаптер
                    использует ручное подтверждение.
                  </small>
                </section>
              </aside>
            </div>
          )}

          {page === "settings" && (
            <div className="editor-layout">
              <div className="editor-main">
                <section className="card">
                  <div className="card-heading">
                    <div>
                      <h2>
                        <ShieldCheck size={19} /> Ограничения и безопасность
                      </h2>
                      <p>Настройки применяются к текущему профилю</p>
                    </div>
                  </div>
                  <NumberField
                    label="Максимум отправок за 24 часа"
                    value={s.daily_limit}
                    min={1}
                    max={200}
                    onChange={(v) => update("daily_limit", v)}
                  />
                  <p className="subtle-note">
                    Это локальное ограничение панели, а не подтверждённый лимит
                    hh.ru. Учитывает только отправки из HH Studio. hh.ru может
                    ограничить отправку раньше.
                  </p>
                  <div className="toggle-row">
                    <div>
                      <strong>Безопасный тестовый режим</strong>
                      <span>Проверять вакансии, не отправляя отклики</span>
                    </div>
                    <button
                      className="switch-button"
                      role="switch"
                      aria-checked={s.dry_run}
                      aria-label="Безопасный режим"
                      onClick={() => update("dry_run", !s.dry_run)}
                    >
                      <Switch checked={s.dry_run} />
                    </button>
                  </div>
                  <div className="card-actions">
                    <button
                      className="button primary"
                      disabled={pending}
                      onClick={() =>
                        act(async () => {
                          await save();
                          notify("Настройки сохранены");
                        })
                      }
                    >
                      <Check size={16} /> Сохранить
                    </button>
                  </div>
                </section>
                <LocalOCRSettings
                  settings={s}
                  pending={pending}
                  status={ocrStatus}
                  onChange={(key, value) => update(key, value as Settings[typeof key])}
                  onSave={() => act(async () => {
                    await save();
                    setOcrStatus(null);
                    notify("Настройки локального OCR сохранены");
                  })}
                  onCheck={() => act(async () => {
                    await save();
                    setOcrStatus(await api(`/profiles/${profileId}/ocr`));
                  })}
                />
                <section className="card">
                  <div className="card-heading">
                    <h2>Внешний вид</h2>
                  </div>
                  <div className="theme-options">
                    <button
                      className={theme === "light" ? "selected" : ""}
                      onClick={() => setTheme("light")}
                    >
                      <Sun size={21} /> Светлая тема{" "}
                      {theme === "light" && <Check size={17} />}
                    </button>
                    <button
                      className={theme === "dark" ? "selected" : ""}
                      onClick={() => setTheme("dark")}
                    >
                      <Moon size={21} /> Тёмная тема{" "}
                      {theme === "dark" && <Check size={17} />}
                    </button>
                  </div>
                </section>
                <section className="card">
                  <div className="card-heading">
                    <h2>О приложении</h2>
                  </div>
                  <div className="summary-line">
                    <span>HH Studio</span>
                    <strong>1.0.0</strong>
                  </div>
                  <div className="summary-line">
                    <span>hh-applicant-tool</span>
                    <strong>{version}</strong>
                  </div>
                  <div className="summary-line">
                    <span>Режим работы</span>
                    <strong>Локальный · 127.0.0.1</strong>
                  </div>
                  <div className="summary-line">
                    <span>Интерфейс</span>
                    <strong>React + FastAPI</strong>
                  </div>
                  <a
                    className="text-button inline-link"
                    href="https://github.com/s3rgeym/hh-applicant-tool"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Исходная утилита <ArrowUpRight size={15} />
                  </a>
                </section>
              </div>
              <aside className="editor-aside">
                <section className="card">
                  <h2>Хранение данных</h2>
                  <p className="body-copy">
                    Профили, история и расписания хранятся в локальной SQLite.
                    API-ключи зашифрованы; ключ шифрования находится на этом же
                    компьютере. Cookies и токены имеют формат исходной утилиты.
                  </p>
                  <p className="body-copy">
                    Планировщик работает, пока сервер запущен и панель открыта.
                    Пропущенные запуски не накапливаются.
                  </p>
                  <button className="text-button" onClick={() => setHelp(true)}>
                    Подробнее о работе <ArrowRight size={15} />
                  </button>
                </section>
              </aside>
            </div>
          )}

          <footer className="page-footer">
            <span>
              <ShieldCheck size={13} /> Локально. Приватно. Под вашим контролем.
            </span>
            <span>
              Сделайте следующий шаг <span className="footer-dot">✦</span>
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div
          className={"toast " + (toast.error ? "error-toast" : "")}
          role="status"
        >
          {toast.error ? <CircleHelp size={19} /> : <CheckCircle2 size={19} />}
          <span>{toast.message}</span>
          <button
            className="icon-button"
            onClick={() => setToast(null)}
            aria-label="Закрыть уведомление"
          >
            <X size={16} />
          </button>
        </div>
      )}
      {state.prompt && !(page === "accounts" && authActive) && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="prompt-title"
          >
            <span className="modal-icon">
              {state.prompt.kind === "captcha" ? (
                <ShieldCheck size={25} />
              ) : (
                <Users size={25} />
              )}
            </span>
            <h2 id="prompt-title">
              {state.prompt.kind === "captcha"
                ? "Проверка безопасности"
                : "Подтвердите вход"}
            </h2>
            {confirmationForm(state.prompt)}
          </section>
        </div>
      )}
      {help && (
        <div className="modal-backdrop" onClick={() => setHelp(false)}>
          <section
            className="modal help-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="icon-button modal-close"
              onClick={() => setHelp(false)}
              aria-label="Закрыть справку"
            >
              <X size={20} />
            </button>
            <span className="modal-icon">
              <Sparkles size={26} />
            </span>
            <h2 id="help-title">Ваш поиск. На автопилоте.</h2>
            <p>Три шага, чтобы освободить время для собеседований.</p>
            <div className="help-step">
              <b>01</b>
              <div>
                <strong>Подключите hh.ru</strong>
                <p>
                  Введите телефон или email. Подтвердите вход кодом в панели.
                </p>
              </div>
            </div>
            <div className="help-step">
              <b>02</b>
              <div>
                <strong>Настройте поиск и письмо</strong>
                <p>Выберите регион, фильтры и осторожный интервал отправки.</p>
              </div>
            </div>
            <div className="help-step">
              <b>03</b>
              <div>
                <strong>Начните с тестового прогона</strong>
                <p>
                  Проверьте результаты в логах. Затем включите реальную
                  отправку.
                </p>
              </div>
            </div>
            <div className="info">
              <ShieldCheck size={19} />
              <span>
                Секреты хранятся локально. Данные hh.ru передаются hh.ru; при
                включении AI — выбранному провайдеру.
              </span>
            </div>
            <button
              className="button primary wide"
              onClick={() => {
                setHelp(false);
                go("accounts");
              }}
            >
              Перейти к аккаунтам <ArrowRight size={16} />
            </button>
          </section>
        </div>
      )}
    </div>
  );
}

function Switch({ checked }: { checked: boolean }) {
  return (
    <span className={"switch " + (checked ? "on" : "")}>
      <i />
    </span>
  );
}
function Stat({
  label,
  value,
  icon: Icon,
  color,
  footer,
  progress,
  trend,
  indicator,
}: {
  label: string;
  value: React.ReactNode;
  icon: typeof Send;
  color: string;
  footer: string;
  progress?: number;
  trend?: string;
  indicator?: boolean;
}) {
  return (
    <article className="stat-card">
      <div className="stat-top">
        <span>{label}</span>
        <div className={"stat-icon " + color}>
          <Icon size={18} />
        </div>
      </div>
      <div className="stat-value">
        {value}
        {trend && (
          <span className="stat-trend">
            <ArrowUpRight size={14} />
            {trend}
          </span>
        )}
        {indicator && <i className="activity-pulse" />}
      </div>
      {progress !== undefined ? (
        <div className="progress-track">
          <span style={{ width: progress + "%" }} />
        </div>
      ) : (
        <div className={"stat-mini-line " + color}>
          <svg viewBox="0 0 100 12" preserveAspectRatio="none">
            <path
              d={
                trend
                  ? "M0 10 L15 9 L30 9 L45 7 L55 8 L70 4 L85 5 L100 1"
                  : "M0 9 L100 9"
              }
            />
          </svg>
        </div>
      )}
      <div className="stat-footer">{footer}</div>
    </article>
  );
}
function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
      />
    </label>
  );
}
function ListField({
  label,
  values,
  onChange,
  placeholder,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
}) {
  const [text, setText] = useState(values.join(", "));
  useEffect(() => {
    if (
      text
        .split(/[,\n]/)
        .map((x) => x.trim())
        .filter(Boolean)
        .join("|") !== values.join("|")
    )
      setText(values.join(", "));
  }, [values]);
  return (
    <label className="field">
      <span>{label}</span>
      <textarea
        rows={4}
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(
            e.target.value
              .split(/[,\n]/)
              .map((x) => x.trim())
              .filter(Boolean),
          );
        }}
        maxLength={10000}
      />
    </label>
  );
}
function ScheduleControl({
  operation,
  schedule,
  onChange,
  disabled,
}: {
  operation: string;
  schedule: Schedule | undefined;
  onChange: (op: string, enabled: boolean, hours: number) => unknown;
  disabled: boolean;
}) {
  const [hours, setHours] = useState(schedule?.hours || 4);
  useEffect(() => setHours(schedule?.hours || 4), [schedule?.hours]);
  return (
    <div className="schedule-control">
      <select
        aria-label="Интервал расписания"
        value={hours}
        disabled={disabled}
        onChange={(e) => {
          const n = +e.target.value;
          setHours(n);
          if (schedule?.enabled) onChange(operation, true, n);
        }}
      >
        {(operation === "bump" ? [4, 6, 8, 12, 24] : [1, 2, 4, 6, 12, 24]).map(
          (n) => (
            <option key={n} value={n}>
              Каждые {n} ч
            </option>
          ),
        )}
      </select>
      <button
        className="switch-button"
        aria-label={
          operation === "bump"
            ? "Автоподнятие резюме"
            : "Автоотклики по расписанию"
        }
        role="switch"
        aria-checked={Boolean(schedule?.enabled)}
        disabled={disabled}
        onClick={() => onChange(operation, !schedule?.enabled, hours)}
      >
        <Switch checked={Boolean(schedule?.enabled)} />
      </button>
    </div>
  );
}
function EmptyState({
  icon: Icon,
  title,
  text,
  button,
  onClick,
}: {
  icon: typeof Send;
  title: string;
  text: string;
  button: string;
  onClick: () => unknown;
}) {
  return (
    <div className="empty-state">
      <div className="empty-art">
        <div />
        <Icon size={30} />
        <span>✦</span>
      </div>
      <h2>{title}</h2>
      <p>{text}</p>
      <button className="button" onClick={onClick}>
        {button}
        <ArrowRight size={16} />
      </button>
    </div>
  );
}
function Chart({
  series,
  days,
}: {
  series: { day: string; count: number }[];
  days: number;
}) {
  const dates = Array.from({ length: days }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - days + i + 1);
    return d;
  });
  const counts = dates.map(
    (d) =>
      series.find((s) => s.day === d.toISOString().slice(0, 10))?.count || 0,
  );
  const max = Math.max(4, ...counts);
  const points = counts
    .map((n, i) => `${(i / (days - 1)) * 600},${116 - (n / max) * 100}`)
    .join(" ");
  return (
    <div className="chart">
      <div className="chart-y">
        {[max, Math.round(max / 2), 0].map((n, i) => (
          <span key={i}>{n}</span>
        ))}
      </div>
      <div className="chart-plot">
        <div className="chart-grid">
          <i />
          <i />
          <i />
        </div>
        <svg
          viewBox="0 0 600 124"
          preserveAspectRatio="none"
          aria-label={`Отправлено ${counts.reduce((a, b) => a + b, 0)} откликов за ${days} дней`}
        >
          <defs>
            <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2ba184" stopOpacity=".15" />
              <stop offset="100%" stopColor="#2ba184" stopOpacity=".01" />
            </linearGradient>
          </defs>
          <polygon points={`0,120 ${points} 600,120`} fill="url(#chart-fill)" />
          <polyline
            points={points}
            fill="none"
            stroke="#269c7f"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {counts.every((n) => n === 0) && (
          <div className="chart-empty-label">
            Первые отклики дадут начало вашей статистике
          </div>
        )}
        <div className="chart-x">
          {dates
            .filter(
              (_, i) =>
                days <= 7 || i % Math.ceil(days / 6) === 0 || i === days - 1,
            )
            .map((d) => (
              <span key={d.toISOString()}>
                {d.toLocaleDateString("ru-RU", {
                  day: "numeric",
                  month: "short",
                })}
              </span>
            ))}
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
