"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Camera, CheckCircle2, ChevronRight, Clock3, Eye, EyeOff, KeyRound, LockKeyhole, LogOut, Monitor, Moon, Pencil, Settings, ShieldCheck, Smartphone, Sun, Trash2, X } from "lucide-react";
import { clsx } from "clsx";
import { Button, Input } from "@/components/ui";
import { useTema } from "@/components/providers";
import type { AuthUser } from "@/lib/session";
import type { PreferenciaTema } from "@/lib/tema";
import { podeAlterarProprioNome, validateUserDisplayName } from "@/lib/usuario-nome";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";

type ProfileData = {
  id: string;
  usuario: string;
  nome: string;
  perfil: string;
  avatarUrl: string | null;
  ultimoLoginAt: string | null;
  createdAt: string;
  dadosCadastrais: {
    responsavel: string;
    razaoSocial: string;
    cnpj: string | null;
    cpf: string | null;
    email: string | null;
    telefone: string | null;
    cargo: string | null;
    inicio: string | null;
    final: string | null;
    validadeLabel: string;
    validadeTone: "danger" | "warning" | "notice" | "success" | "neutral";
  } | null;
};

type AccountMenuProps = {
  user: AuthUser;
  roleLabel: string;
  onLogout: () => void;
  compact?: boolean;
};

const TEMA_OPCOES: { valor: PreferenciaTema; rotulo: string; Icone: typeof Sun }[] = [
  { valor: "claro", rotulo: "Claro", Icone: Sun },
  { valor: "escuro", rotulo: "Escuro", Icone: Moon },
  { valor: null, rotulo: "Sistema", Icone: Monitor },
];

function initials(value: string | null | undefined) {
  const parts = (value ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

function dateTimeLabel(value: string | null | undefined) {
  if (!value) return "Não registrado";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function dateLabel(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR").format(new Date(value));
}

function ReadOnlyField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted-foreground)]">{label}</p>
        <LockKeyhole size={13} className="shrink-0 text-[var(--muted-foreground)]" aria-hidden="true" />
      </div>
      <p className="mt-1.5 break-words text-sm font-semibold text-[var(--foreground)]">{value || "-"}</p>
    </div>
  );
}

function NameField({
  value,
  editing,
  draft,
  saving,
  error,
  onEdit,
  onDraftChange,
  onCancel,
  onSave,
}: {
  value: string;
  editing: boolean;
  draft: string;
  saving: boolean;
  error: string | null;
  onEdit: () => void;
  onDraftChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  if (!editing) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-3 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted-foreground)]">Nome</p>
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold text-[var(--primary)] transition hover:bg-[var(--primary-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/25"
          >
            <Pencil size={12} />
            Editar
          </button>
        </div>
        <p className="mt-1.5 break-words text-sm font-semibold text-[var(--foreground)]">{value || "-"}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--primary)] bg-[var(--surface)] px-3 py-3 shadow-sm">
      <label htmlFor="account-nome" className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
        Nome
      </label>
      <Input
        id="account-nome"
        autoFocus
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); onSave(); }
          if (event.key === "Escape") { event.preventDefault(); onCancel(); }
        }}
        maxLength={120}
        disabled={saving}
        className="mt-1.5"
      />
      {error && <p className="mt-1.5 text-xs font-semibold text-[var(--error)]">{error}</p>}
      <div className="mt-2.5 flex justify-end gap-2">
        <Button type="button" variant="ghost" className="h-8 px-3 text-xs" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
        <Button type="button" className="h-8 px-3 text-xs" onClick={onSave} disabled={saving}>
          {saving ? "Salvando..." : "Salvar"}
        </Button>
      </div>
    </div>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  visible,
  onToggle,
  autoComplete,
  helper,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onToggle: () => void;
  autoComplete: string;
  helper?: string;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-semibold text-[var(--foreground)]" htmlFor={id}>
      {label}
      <span className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          className="pr-11"
        />
        <button
          type="button"
          className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-[var(--muted-foreground)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/25"
          onClick={onToggle}
          aria-label={visible ? `Ocultar ${label.toLowerCase()}` : `Mostrar ${label.toLowerCase()}`}
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </span>
      {helper && <span className="text-xs font-normal text-[var(--muted-foreground)]">{helper}</span>}
    </label>
  );
}

function Requirement({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className={clsx("flex items-center gap-2 text-xs font-medium", ok ? "text-[var(--success)]" : "text-[var(--muted-foreground)]")}>
      <span className={clsx("h-1.5 w-1.5 rounded-full", ok ? "bg-[var(--success)]" : "bg-[var(--border-strong)]")} />
      {children}
    </li>
  );
}

function Avatar({
  name,
  src,
  size = "md",
}: {
  name: string;
  src?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const sizeClass = size === "lg" ? "h-28 w-28 text-3xl" : size === "sm" ? "h-[34px] w-[34px] text-xs" : "h-12 w-12 text-sm";
  return (
    <span className={clsx("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--primary-soft)] font-bold text-[var(--primary)]", sizeClass)}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        initials(name)
      )}
    </span>
  );
}

export function AccountMenu({ user, roleLabel, onLogout, compact = false }: AccountMenuProps) {
  const { preferencia, setPreferencia } = useTema();
  const [menuOpen, setMenuOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [tab, setTab] = useState<"account" | "security">("account");
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [sessionInfo, setSessionInfo] = useState({
    browser: "Navegador atual",
    os: "Sistema operacional",
    device: "desktop" as "desktop" | "mobile",
    location: "Localização não informada",
  });
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [nameEditing, setNameEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const displayProfile = profile ?? {
    id: user.id,
    usuario: user.usuario,
    nome: user.nome,
    perfil: user.perfil,
    avatarUrl: null,
    ultimoLoginAt: null,
    createdAt: new Date().toISOString(),
    dadosCadastrais: null,
  };

  const avatarSrc = useMemo(() => displayProfile.avatarUrl ?? null, [displayProfile.avatarUrl]);
  const passwordRules = useMemo(() => ({
    length: newPassword.length >= MIN_PASSWORD_LENGTH,
    uppercase: /[A-ZÁÉÍÓÚÂÊÔÃÕÇ]/.test(newPassword),
    number: /\d/.test(newPassword),
    match: !!newPassword && newPassword === confirmPassword,
  }), [confirmPassword, newPassword]);

  async function loadProfile() {
    const res = await fetch("/api/usuario/me", { cache: "no-store" });
    if (!res.ok) return;
    const data: ProfileData = await res.json();
    setProfile(data);
  }

  useEffect(() => {
    loadProfile();
  }, []);

  useEffect(() => {
    const ua = navigator.userAgent;
    const browser = ua.includes("Edg/")
      ? "Microsoft Edge"
      : ua.includes("Chrome/")
        ? "Chrome"
        : ua.includes("Firefox/")
          ? "Firefox"
          : ua.includes("Safari/")
            ? "Safari"
            : "Navegador atual";
    const os = ua.includes("Windows")
      ? "Windows"
      : ua.includes("Mac OS")
        ? "macOS"
        : ua.includes("Android")
          ? "Android"
          : /iPhone|iPad/.test(ua)
            ? "iOS"
            : ua.includes("Linux")
              ? "Linux"
              : "Sistema operacional";
    const device = /Android|iPhone|iPad|Mobile/i.test(ua) ? "mobile" : "desktop";
    const localeParts = Intl.DateTimeFormat().resolvedOptions().timeZone?.split("/") ?? [];
    const location = localeParts.length > 1 ? localeParts[localeParts.length - 1].replace(/_/g, " ") : "Localização não informada";
    setSessionInfo({ browser, os, device, location });
  }, []);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  useEffect(() => {
    if (!modalOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModalOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [modalOpen]);

  function openSettings(initialTab: "account" | "security" = "account") {
    setTab(initialTab);
    setModalOpen(true);
    setMenuOpen(false);
    setFeedback(null);
    loadProfile();
  }

  async function uploadAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setAvatarUploading(true);
    setFeedback(null);
    const form = new FormData();
    form.append("avatar", file);
    const res = await fetch("/api/usuario/avatar", { method: "POST", body: form });
    const payload = await res.json().catch(() => ({}));
    setAvatarUploading(false);
    event.target.value = "";
    if (!res.ok) {
      setFeedback({ type: "error", text: payload.error ?? "Não foi possível atualizar a foto." });
      return;
    }
    setProfile((current) => current ? { ...current, avatarUrl: payload.avatarUrl } : current);
    setFeedback({ type: "success", text: "Foto de perfil atualizada." });
  }

  async function removeAvatar() {
    setAvatarUploading(true);
    setFeedback(null);
    const res = await fetch("/api/usuario/avatar", { method: "DELETE" });
    const payload = await res.json().catch(() => ({}));
    setAvatarUploading(false);
    if (!res.ok) {
      setFeedback({ type: "error", text: payload.error ?? "Não foi possível remover a foto." });
      return;
    }
    setProfile((current) => current ? { ...current, avatarUrl: null } : current);
    setFeedback({ type: "success", text: "Foto removida." });
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setFeedback(null);
    if (newPassword !== confirmPassword) {
      setFeedback({ type: "error", text: "A confirmação precisa ser igual à nova senha." });
      return;
    }
    setPasswordSaving(true);
    const res = await fetch("/api/auth/alterar-senha", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senhaAtual: currentPassword, novaSenha: newPassword }),
    });
    const payload = await res.json().catch(() => ({}));
    setPasswordSaving(false);
    if (!res.ok) {
      setFeedback({ type: "error", text: payload.error ?? "Não foi possível alterar a senha." });
      return;
    }
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setFeedback({ type: "success", text: "Senha alterada com sucesso." });
  }

  function startNameEdit() {
    setNameDraft(displayProfile.nome);
    setNameError(null);
    setNameEditing(true);
  }

  function cancelNameEdit() {
    setNameEditing(false);
    setNameDraft("");
    setNameError(null);
  }

  async function saveName() {
    const validationError = validateUserDisplayName(nameDraft);
    if (validationError) {
      setNameError(validationError);
      return;
    }
    setNameSaving(true);
    setNameError(null);
    const res = await fetch("/api/usuario/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome: nameDraft.trim() }),
    });
    const payload = await res.json().catch(() => ({}));
    setNameSaving(false);
    if (!res.ok) {
      setNameError(payload.error ?? "Não foi possível atualizar o nome.");
      return;
    }
    setProfile((current) => current ? { ...current, nome: payload.user.nome } : current);
    setNameEditing(false);
    setNameDraft("");
    setFeedback({ type: "success", text: "Nome atualizado com sucesso." });
  }

  return (
    <>
      <div ref={menuRef} className={clsx("relative", compact && "flex items-center gap-1")}>
        <button
          type="button"
          onClick={() => setMenuOpen((value) => !value)}
          className={clsx(
            "flex items-center gap-2 rounded-lg border border-transparent px-1.5 py-1 text-left transition-colors",
            compact ? "min-w-0 flex-1 text-white hover:bg-white/[0.06]" : "w-full hover:border-[var(--border)] hover:bg-[var(--surface-muted)]",
          )}
          title="Conta"
        >
          <Avatar name={displayProfile.nome} src={avatarSrc} size="sm" />
          <div className={clsx("max-w-40 leading-tight", !compact && "hidden md:block")}>
            <p className={clsx("truncate text-[12px] font-semibold", compact ? "text-white" : "text-[var(--foreground)]")}>{displayProfile.nome}</p>
            <p className={clsx("truncate text-[10px] uppercase tracking-wide", compact ? "text-white/45" : "text-[var(--muted-foreground)]")}>{roleLabel}</p>
          </div>
        </button>

        {compact && (
          <button
            type="button"
            onClick={onLogout}
            className="inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-md text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            title="Sair"
            aria-label="Sair"
          >
            <LogOut size={16} />
          </button>
        )}

        {menuOpen && (
          <div className={clsx(
            "absolute z-50 w-[288px] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-xl transition-[opacity,translate] duration-150 ease-out starting:translate-y-1 starting:opacity-0 motion-reduce:transition-none",
            compact ? "bottom-12 left-0" : "right-0 top-12",
          )}>
            <div className="border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-5">
              <div className="flex items-center gap-3">
                <Avatar name={displayProfile.nome} src={avatarSrc} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-[var(--foreground)]">{displayProfile.nome}</p>
                  <p className="mt-0.5 truncate font-mono text-xs font-semibold text-[var(--muted-foreground)]">{displayProfile.usuario}</p>
                  <span className="mt-2 inline-flex max-w-full items-center rounded-full border border-[var(--primary)]/30 bg-[var(--primary-soft)] px-2 py-0.5 text-[11px] font-bold text-[var(--primary)]">
                    {roleLabel}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid gap-1 p-2">
              <button
                type="button"
                className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-[var(--foreground)] transition hover:bg-[var(--primary-soft)] hover:text-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/25"
                onClick={() => openSettings("account")}
              >
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--surface-hover)] text-[var(--muted-foreground)]">
                  <Settings size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">Configurações</span>
                  <span className="block truncate text-xs font-medium text-[var(--muted-foreground)]">Conta e dados pessoais</span>
                </span>
                <ChevronRight size={15} className="shrink-0 text-[var(--muted-foreground)]" />
              </button>
              <button
                type="button"
                className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-[var(--foreground)] transition hover:bg-[var(--primary-soft)] hover:text-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/25"
                onClick={() => openSettings("security")}
              >
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--surface-hover)] text-[var(--muted-foreground)]">
                  <KeyRound size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">Segurança</span>
                  <span className="block truncate text-xs font-medium text-[var(--muted-foreground)]">Senha e sessões</span>
                </span>
                <ChevronRight size={15} className="shrink-0 text-[var(--muted-foreground)]" />
              </button>
            </div>

            <div className="border-t border-[var(--border)] px-4 py-3">
              <p id="tema-rotulo" className="text-label mb-2 text-[var(--muted-foreground)]">Tema</p>
              <div role="group" aria-labelledby="tema-rotulo" className="grid grid-cols-3 gap-1 rounded-lg bg-[var(--surface-muted)] p-1">
                {TEMA_OPCOES.map(({ valor, rotulo, Icone }) => (
                  <button
                    key={rotulo}
                    type="button"
                    aria-pressed={preferencia === valor}
                    onClick={() => setPreferencia(valor)}
                    className={clsx(
                      "inline-flex h-8 items-center justify-center gap-1.5 rounded-md text-[12px] font-semibold transition-colors",
                      preferencia === valor
                        ? "bg-[var(--surface)] text-[var(--foreground)] shadow-sm"
                        : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
                    )}
                  >
                    <Icone size={14} aria-hidden />
                    {rotulo}
                  </button>
                ))}
              </div>
            </div>

            <div className="border-t border-[var(--border)] bg-[var(--surface)] p-2">
              <button
                type="button"
                className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-bold text-[var(--error)] transition hover:bg-[var(--error-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--error)]/20"
                onClick={onLogout}
              >
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--error-soft)] text-[var(--error)]">
                  <LogOut size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">Sair</span>
                  <span className="block truncate text-xs font-semibold text-[var(--error)]">Encerrar sessão atual</span>
                </span>
              </button>
            </div>
          </div>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/35 p-3 pt-8 sm:p-8">
          <div className="flex max-h-[min(720px,calc(100vh-48px))] w-full max-w-[760px] flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-2xl">
            <div className="flex h-10 items-center justify-between border-b border-[var(--border)] px-3">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className={clsx("rounded-md px-3 py-1.5 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/25", tab === "account" ? "bg-[var(--primary)] text-[var(--on-solid)] shadow-sm" : "text-[var(--muted-foreground)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]")}
                  onClick={() => setTab("account")}
                >
                  Conta
                </button>
                <button
                  type="button"
                  className={clsx("rounded-md px-3 py-1.5 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/25", tab === "security" ? "bg-[var(--primary)] text-[var(--on-solid)] shadow-sm" : "text-[var(--muted-foreground)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]")}
                  onClick={() => setTab("security")}
                >
                  Segurança
                </button>
              </div>
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--muted-foreground)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
                onClick={() => setModalOpen(false)}
                aria-label="Fechar"
              >
                <X size={16} />
              </button>
            </div>

            <div className="overflow-y-auto px-6 py-8 sm:px-10">
              {feedback && (
                <div className={clsx(
                  "mb-5 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                  feedback.type === "success" ? "border-[var(--success)]/30 bg-[var(--success-soft)] text-[var(--success)]" : "border-[var(--error)]/30 bg-[var(--error-soft)] text-[var(--error)]",
                )}>
                  <CheckCircle2 size={16} />
                  {feedback.text}
                </div>
              )}

              {tab === "account" ? (
                <div className="grid gap-7">
                  <section className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-5">
                    <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                      <div className="relative h-28 w-28 shrink-0">
                        <Avatar name={displayProfile.nome} src={avatarSrc} size="lg" />
                        <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={uploadAvatar} />
                        <button
                          type="button"
                          className="absolute bottom-1 right-1 inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--muted-foreground)] shadow-sm transition hover:border-[var(--primary)] hover:text-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/30"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={avatarUploading}
                          aria-label="Alterar foto de perfil"
                          title="Alterar foto"
                        >
                          <Camera size={16} />
                        </button>
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="truncate text-2xl font-bold text-[var(--foreground)]">{displayProfile.nome}</h2>
                          <span className="inline-flex items-center rounded-full border border-[var(--primary)]/30 bg-[var(--primary-soft)] px-2.5 py-1 text-xs font-bold text-[var(--primary)]">
                            {roleLabel}
                          </span>
                        </div>
                        <p className="mt-1 text-sm font-medium text-[var(--muted-foreground)]">ID de acesso {displayProfile.usuario}</p>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm font-semibold text-[var(--muted-foreground)] shadow-sm transition hover:border-[var(--primary)] hover:text-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-60"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={avatarUploading}
                          >
                            <Camera size={15} />
                            Alterar foto
                          </button>
                          {avatarSrc && (
                            <button
                              type="button"
                              className="inline-flex items-center gap-2 rounded-lg border border-[var(--error)]/30 bg-[var(--surface)] px-3 py-2 text-sm font-semibold text-[var(--error)] shadow-sm transition hover:bg-[var(--error-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                              onClick={() => {
                                if (window.confirm("Remover a foto de perfil?")) removeAvatar();
                              }}
                              disabled={avatarUploading}
                            >
                              <Trash2 size={15} />
                              Remover
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </section>

                  <section className="grid gap-4">
                    <div>
                      <h3 className="text-base font-bold text-[var(--foreground)]">Dados pessoais</h3>
                      <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                        {podeAlterarProprioNome(displayProfile.perfil)
                          ? "Gerencie as informações da sua conta."
                          : "Seu nome é atualizado pelo Painel Administrativo."}
                      </p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {podeAlterarProprioNome(displayProfile.perfil) ? <NameField
                        value={displayProfile.nome}
                        editing={nameEditing}
                        draft={nameDraft}
                        saving={nameSaving}
                        error={nameError}
                        onEdit={startNameEdit}
                        onDraftChange={setNameDraft}
                        onCancel={cancelNameEdit}
                        onSave={saveName}
                      /> : <ReadOnlyField label="Nome" value={displayProfile.nome} />}
                      <ReadOnlyField label="Permissão" value={roleLabel} />
                    </div>
                  </section>

                  {displayProfile.dadosCadastrais && (
                    <section className="grid gap-4">
                      <div>
                        <h3 className="text-base font-bold text-[var(--foreground)]">Dados cadastrais</h3>
                        <p className="mt-1 text-sm text-[var(--muted-foreground)]">Atualizados pelo Painel Administrativo.</p>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <ReadOnlyField label="Responsável" value={displayProfile.dadosCadastrais.responsavel} />
                        <ReadOnlyField label="Cargo" value={displayProfile.dadosCadastrais.cargo} />
                        <ReadOnlyField label="Razão social" value={displayProfile.dadosCadastrais.razaoSocial} />
                        <ReadOnlyField label="CNPJ" value={displayProfile.dadosCadastrais.cnpj} />
                        <ReadOnlyField label="CPF" value={displayProfile.dadosCadastrais.cpf} />
                        <ReadOnlyField label="E-mail" value={displayProfile.dadosCadastrais.email} />
                        <ReadOnlyField label="Telefone" value={displayProfile.dadosCadastrais.telefone} />
                        <ReadOnlyField label="Validade" value={`${dateLabel(displayProfile.dadosCadastrais.final)} - ${displayProfile.dadosCadastrais.validadeLabel}`} />
                      </div>
                    </section>
                  )}

                  <section className="grid gap-4">
                    <h3 className="text-base font-bold text-[var(--foreground)]">Dados de acesso</h3>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-lg border border-[var(--primary)]/30 bg-[var(--primary-soft)] px-4 py-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--primary)]">ID de acesso</p>
                          <LockKeyhole size={13} className="text-[var(--primary)]" aria-hidden="true" />
                        </div>
                        <p className="mt-2 font-mono text-lg font-bold tracking-wide text-[var(--foreground)]">{displayProfile.usuario}</p>
                      </div>
                      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3 shadow-sm">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted-foreground)]">Perfil</p>
                          <ShieldCheck size={14} className="text-[var(--success)]" aria-hidden="true" />
                        </div>
                        <p className="mt-2 text-sm font-bold text-[var(--foreground)]">{roleLabel}</p>
                      </div>
                    </div>
                  </section>
                </div>
              ) : (
                <div className="grid gap-7">
                  <section className="grid gap-4">
                    <div>
                      <h3 className="text-base font-bold text-[var(--foreground)]">Alterar senha</h3>
                      <p className="mt-1 text-sm text-[var(--muted-foreground)]">Atualize sua senha mantendo os requisitos mínimos de segurança.</p>
                    </div>

                    <form className="grid gap-5 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-5" onSubmit={changePassword}>
                      <div className="grid gap-4 lg:grid-cols-[1fr_240px]">
                        <div className="grid gap-4">
                          <PasswordField
                            id="current-password"
                            label="Senha atual"
                            value={currentPassword}
                            onChange={setCurrentPassword}
                            visible={showCurrentPassword}
                            onToggle={() => setShowCurrentPassword((value) => !value)}
                            autoComplete="current-password"
                            helper="Necessária para confirmar sua identidade."
                          />
                          <PasswordField
                            id="new-password"
                            label="Nova senha"
                            value={newPassword}
                            onChange={setNewPassword}
                            visible={showNewPassword}
                            onToggle={() => setShowNewPassword((value) => !value)}
                            autoComplete="new-password"
                            helper="Evite repetir senhas usadas anteriormente."
                          />
                          <PasswordField
                            id="confirm-password"
                            label="Confirmar nova senha"
                            value={confirmPassword}
                            onChange={setConfirmPassword}
                            visible={showConfirmPassword}
                            onToggle={() => setShowConfirmPassword((value) => !value)}
                            autoComplete="new-password"
                            helper="Digite novamente para evitar erros."
                          />
                        </div>

                        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
                          <p className="text-sm font-bold text-[var(--foreground)]">Requisitos</p>
                          <ul className="mt-3 grid gap-2">
                            <Requirement ok={passwordRules.length}>{MIN_PASSWORD_LENGTH} ou mais caracteres</Requirement>
                            <Requirement ok={passwordRules.uppercase}>Ao menos uma letra maiúscula</Requirement>
                            <Requirement ok={passwordRules.number}>Ao menos um número</Requirement>
                            <Requirement ok={passwordRules.match}>Confirmação igual à nova senha</Requirement>
                          </ul>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
                        <p className="text-xs text-[var(--muted-foreground)]">A alteração será aplicada imediatamente após a confirmação.</p>
                        <Button
                          type="submit"
                          disabled={passwordSaving || !currentPassword || !passwordRules.length || !passwordRules.uppercase || !passwordRules.number || !passwordRules.match}
                        >
                          <KeyRound size={14} />
                          Atualizar senha
                        </Button>
                      </div>
                    </form>
                  </section>

                  <section className="grid gap-4 border-t border-[var(--border)] pt-7">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <ShieldCheck size={18} className="text-[var(--primary)]" />
                          <h3 className="text-base font-bold text-[var(--foreground)]">Sessões ativas</h3>
                        </div>
                        <p className="mt-1 text-sm text-[var(--muted-foreground)]">Acompanhe os acessos e encerre sessões que você não reconhece.</p>
                      </div>
                      <Button variant="secondary" onClick={onLogout}>
                        <LogOut size={14} />
                        Encerrar sessão atual
                      </Button>
                    </div>

                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
                      <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
                        <div className="flex min-w-0 items-start gap-3">
                          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--primary-soft)] text-[var(--primary)]">
                            {sessionInfo.device === "mobile" ? <Smartphone size={20} /> : <Monitor size={20} />}
                          </span>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-bold text-[var(--foreground)]">{sessionInfo.browser} em {sessionInfo.os}</p>
                              <span className="rounded-full bg-[var(--success-soft)] px-2 py-0.5 text-xs font-bold text-[var(--success)]">Atual</span>
                            </div>
                            <p className="mt-1 text-sm text-[var(--muted-foreground)]">{sessionInfo.location}</p>
                          </div>
                        </div>
                        <div className="grid gap-1 text-sm sm:text-right">
                          <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--foreground)] sm:justify-end">
                            <Clock3 size={14} className="text-[var(--muted-foreground)]" />
                            {dateTimeLabel(displayProfile.ultimoLoginAt)}
                          </span>
                          <span className="text-xs font-medium text-[var(--muted-foreground)]">Último acesso registrado</span>
                        </div>
                      </div>
                    </div>
                  </section>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
