"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Camera, CheckCircle2, ChevronRight, KeyRound, LogOut, Settings, ShieldCheck, Trash2, UserRound, X } from "lucide-react";
import { clsx } from "clsx";
import { Button, IconButton, Input } from "@/components/ui";
import type { AuthUser } from "@/lib/session";

type ProfileData = {
  id: string;
  usuario: string;
  nome: string;
  perfil: string;
  avatarUrl: string | null;
  ultimoLoginAt: string | null;
  createdAt: string;
};

type AccountMenuProps = {
  user: AuthUser;
  roleLabel: string;
  onLogout: () => void;
};

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

function Avatar({
  name,
  src,
  size = "md",
}: {
  name: string;
  src?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const sizeClass = size === "lg" ? "h-28 w-28 text-3xl" : size === "sm" ? "h-9 w-9 text-xs" : "h-12 w-12 text-sm";
  return (
    <span className={clsx("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#EFF6FF] font-bold text-[#2563EB]", sizeClass)}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        initials(name)
      )}
    </span>
  );
}

export function AccountMenu({ user, roleLabel, onLogout }: AccountMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [tab, setTab] = useState<"account" | "security">("account");
  const [editingName, setEditingName] = useState(false);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [nameDraft, setNameDraft] = useState(user.nome);
  const [savingName, setSavingName] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
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
  };

  const avatarSrc = useMemo(() => displayProfile.avatarUrl ?? null, [displayProfile.avatarUrl]);

  async function loadProfile() {
    const res = await fetch("/api/usuario/me", { cache: "no-store" });
    if (!res.ok) return;
    const data: ProfileData = await res.json();
    setProfile(data);
    setNameDraft(data.nome);
  }

  useEffect(() => {
    loadProfile();
  }, []);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  function openSettings(initialTab: "account" | "security" = "account") {
    setTab(initialTab);
    setModalOpen(true);
    setMenuOpen(false);
    setEditingName(false);
    setFeedback(null);
    loadProfile();
  }

  async function saveName(event: FormEvent) {
    event.preventDefault();
    setSavingName(true);
    setFeedback(null);
    const res = await fetch("/api/usuario/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome: nameDraft }),
    });
    const payload = await res.json().catch(() => ({}));
    setSavingName(false);
    if (!res.ok) {
      setFeedback({ type: "error", text: payload.error ?? "Não foi possível atualizar o nome." });
      return;
    }
    setProfile(payload);
    setEditingName(false);
    setFeedback({ type: "success", text: "Nome atualizado com sucesso." });
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

  return (
    <>
      <div ref={menuRef} className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen((value) => !value)}
          className="flex items-center gap-2 rounded-lg border border-transparent px-1.5 py-1 text-left transition hover:border-[#E5E7EB] hover:bg-[#F9FAFB]"
          title="Conta"
        >
          <Avatar name={displayProfile.nome} src={avatarSrc} size="sm" />
          <div className="hidden max-w-40 leading-tight md:block">
            <p className="truncate text-sm font-semibold text-[#1A1A1A]">{displayProfile.nome}</p>
            <p className="truncate text-xs text-[#555555]">{roleLabel}</p>
          </div>
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-12 z-50 w-[280px] overflow-hidden rounded-xl border border-[#E5E7EB] bg-white shadow-xl">
            <div className="flex flex-col items-center border-b border-[#F3F4F6] px-4 py-5 text-center">
              <Avatar name={displayProfile.nome} src={avatarSrc} />
              <p className="mt-3 max-w-full truncate text-sm font-bold text-[#1A1A1A]">{displayProfile.nome}</p>
              <p className="max-w-full truncate text-xs text-[#6B7280]">{displayProfile.usuario}</p>
            </div>
            <div className="p-2">
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-semibold text-[#1A1A1A] hover:bg-[#EFF6FF] hover:text-[#2563EB]"
                onClick={() => openSettings("account")}
              >
                <Settings size={16} />
                Configurações
                <ChevronRight size={15} className="ml-auto" />
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-semibold text-[#1A1A1A] hover:bg-[#EFF6FF] hover:text-[#2563EB]"
                onClick={() => openSettings("security")}
              >
                <KeyRound size={16} />
                Segurança
                <ChevronRight size={15} className="ml-auto" />
              </button>
            </div>
            <div className="border-t border-[#F3F4F6] p-2">
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-semibold text-[#AF1B1B] hover:bg-[#FEF2F2]"
                onClick={onLogout}
              >
                <LogOut size={16} />
                Sair
              </button>
            </div>
          </div>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/35 p-3 pt-8 sm:p-8">
          <div className="flex max-h-[min(720px,calc(100vh-48px))] w-full max-w-[760px] flex-col overflow-hidden rounded-lg border border-[#E5E7EB] bg-white shadow-2xl">
            <div className="flex h-10 items-center justify-between border-b border-[#E5E7EB] px-3">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className={clsx("rounded-md px-3 py-1.5 text-sm font-medium transition", tab === "account" ? "bg-[#F3F4F6] text-[#1A1A1A]" : "text-[#6B7280] hover:bg-[#F9FAFB] hover:text-[#1A1A1A]")}
                  onClick={() => setTab("account")}
                >
                  Conta
                </button>
                <button
                  type="button"
                  className={clsx("rounded-md px-3 py-1.5 text-sm font-medium transition", tab === "security" ? "bg-[#F3F4F6] text-[#1A1A1A]" : "text-[#6B7280] hover:bg-[#F9FAFB] hover:text-[#1A1A1A]")}
                  onClick={() => setTab("security")}
                >
                  Segurança
                </button>
              </div>
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#6B7280] transition hover:bg-[#F3F4F6] hover:text-[#1A1A1A]"
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
                  feedback.type === "success" ? "border-[#BBF7D0] bg-[#F0FDF4] text-[#166534]" : "border-[#FECACA] bg-[#FEF2F2] text-[#991B1B]",
                )}>
                  <CheckCircle2 size={16} />
                  {feedback.text}
                </div>
              )}

              {tab === "account" ? (
                <div className="grid gap-10 md:grid-cols-[130px_1fr]">
                  <div className="flex flex-col items-center gap-3">
                    <Avatar name={displayProfile.nome} src={avatarSrc} size="lg" />
                    <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={uploadAvatar} />
                    <button
                      type="button"
                      className="text-sm font-medium text-[#1A1A1A] transition hover:text-[#2563EB]"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={avatarUploading}
                    >
                      Editar
                    </button>
                    {avatarSrc && (
                      <button
                        type="button"
                        className="text-xs font-medium text-[#AF1B1B] hover:underline"
                        onClick={removeAvatar}
                        disabled={avatarUploading}
                      >
                        Remover foto
                      </button>
                    )}
                  </div>

                  <div className="grid gap-8">
                    <section className="grid gap-3">
                      <div>
                        <h3 className="text-base font-medium text-[#1A1A1A]">Nome</h3>
                        {!editingName && <p className="mt-4 text-sm text-[#1A1A1A]">{displayProfile.nome}</p>}
                      </div>
                      {editingName ? (
                        <form className="grid max-w-md gap-3" onSubmit={saveName}>
                          <Input value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} autoFocus />
                          <div className="flex flex-wrap gap-2">
                            <Button type="submit" disabled={savingName}>
                              Salvar
                            </Button>
                            <Button
                              variant="ghost"
                              onClick={() => {
                                setNameDraft(displayProfile.nome);
                                setEditingName(false);
                              }}
                            >
                              Cancelar
                            </Button>
                          </div>
                        </form>
                      ) : (
                        <button
                          type="button"
                          className="w-fit text-sm font-medium text-[#2563EB] transition hover:text-[#1D4ED8] hover:underline"
                          onClick={() => setEditingName(true)}
                        >
                          Alterar nome
                        </button>
                      )}
                    </section>

                    <section className="grid gap-5">
                      <h3 className="text-base font-medium text-[#1A1A1A]">Acesso</h3>
                      <div className="grid gap-5 text-sm">
                        <div>
                          <p className="mb-3 text-[#1A1A1A]">{displayProfile.usuario}</p>
                          <p className="text-[#6B7280]">Gerenciado pela plataforma</p>
                        </div>
                        <div>
                          <p className="text-xs font-medium uppercase text-[#9CA3AF]">Perfil</p>
                          <p className="mt-1 text-[#1A1A1A]">{roleLabel}</p>
                        </div>
                      </div>
                    </section>
                  </div>
                </div>
              ) : (
                <div className="grid gap-9">
                  <form className="grid max-w-md gap-3" onSubmit={changePassword}>
                    <div>
                      <h3 className="text-base font-medium text-[#1A1A1A]">Alterar senha</h3>
                      <p className="mt-1 text-sm text-[#6B7280]">Use uma senha com pelo menos 8 caracteres.</p>
                    </div>
                    <Input type="password" placeholder="Senha atual" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" />
                    <Input type="password" placeholder="Nova senha" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" />
                    <Input type="password" placeholder="Confirmar nova senha" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" />
                    <div>
                      <Button type="submit" disabled={passwordSaving}>
                        <KeyRound size={14} />
                        Atualizar senha
                      </Button>
                    </div>
                  </form>

                  <div className="border-t border-[#E5E7EB] pt-7">
                    <div className="mb-4 flex items-center gap-2">
                      <ShieldCheck size={18} className="text-[#2563EB]" />
                      <h3 className="text-base font-medium text-[#1A1A1A]">Sessões</h3>
                    </div>
                    <p className="mb-7 text-sm text-[#1A1A1A]">Todas as suas sessões ativas aparecem abaixo. Encerre acessos que você não reconhece.</p>
                    <div className="grid gap-3 rounded-lg border border-[#E5E7EB] bg-[#FAFAFA] p-4 text-sm sm:grid-cols-[1fr_1fr_120px]">
                      <div>
                        <p className="text-xs font-bold uppercase text-[#9CA3AF]">Dispositivo</p>
                        <p className="font-semibold text-[#1A1A1A]">Sessão atual</p>
                      </div>
                      <div>
                        <p className="text-xs font-bold uppercase text-[#9CA3AF]">Último acesso</p>
                        <p className="font-semibold text-[#1A1A1A]">{dateTimeLabel(displayProfile.ultimoLoginAt)}</p>
                      </div>
                      <div>
                        <p className="text-xs font-bold uppercase text-[#9CA3AF]">Status</p>
                        <p className="font-semibold text-[#16A34A]">Ativa</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
