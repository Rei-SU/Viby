<script lang="ts">
  import type { AccountCredentials } from '@shared/account'
  import { account, syncSummary } from '../lib/account.svelte'
  import SignInForm from './SignInForm.svelte'
  import Icon from './Icon.svelte'

  type Mode = 'sign-in' | 'sign-up'

  let sheet = $state<HTMLElement>()

  let mode = $state<Mode>('sign-in')
  let formError = $state('')
  let formBusy = $state(false)
  let notice = $state('')

  let resendBusy = $state(false)
  let resendError = $state('')
  let code = $state('')
  let codeBusy = $state(false)
  let codeError = $state('')

  let signingOut = $state(false)
  let signOutError = $state('')

  let syncBusy = $state(false)

  let exportBusy = $state(false)
  let exportNote = $state('')
  let exportError = $state('')

  let confirmingDelete = $state(false)
  let deleteText = $state('')
  let deleteBusy = $state(false)
  let deleteError = $state('')

  let passwordOpen = $state(false)
  let newPassword = $state('')
  let confirmPassword = $state('')
  let passwordBusy = $state(false)
  let passwordError = $state('')
  let passwordNotice = $state('')

  const status = $derived(account.status)
  const sync = $derived(account.sync)

  const deleteReady = $derived.by(() => {
    const current = account.status
    if (current.state !== 'signed-in') return false
    return deleteText.trim().toLowerCase() === current.email.trim().toLowerCase()
  })

  // Fresh panel every time it opens: a request that failed after the last close
  // may have left an error behind, and no half-finished delete confirmation
  // should be waiting for a stray Enter. Focus lands on the first field when
  // there is one, otherwise on the panel itself.
  $effect(() => {
    if (!account.open) return
    const panel = sheet
    if (!panel) return

    formError = ''
    notice = ''
    resendError = ''
    code = ''
    codeError = ''
    signOutError = ''
    exportError = ''
    exportNote = ''
    deleteError = ''
    confirmingDelete = false
    deleteText = ''
    passwordOpen = false
    newPassword = ''
    confirmPassword = ''
    passwordError = ''
    passwordNotice = ''

    const first = panel.querySelector<HTMLInputElement>('input:not(:disabled)')
    ;(first ?? panel).focus()
  })

  // A state change (signed out, in, or waiting for a link) replaces the body and
  // takes whatever had focus with it. Keep focus inside the panel — but only
  // when the state value actually changes: a token refresh pushes the same
  // signed-in state and must not yank focus out of the delete confirmation.
  let lastState = account.status.state
  $effect(() => {
    const state = account.status.state
    if (!account.open) {
      lastState = state
      return
    }
    if (state === lastState) return
    lastState = state
    const panel = sheet
    if (panel && !panel.contains(document.activeElement)) panel.focus()
  })

  function restoreTrigger(): void {
    document.querySelector<HTMLElement>('[data-account-trigger]')?.focus()
  }

  function close(): void {
    account.close()
    restoreTrigger()
  }

  function onKeydown(event: KeyboardEvent): void {
    if (!account.open) return

    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }

    if (event.key !== 'Tab' || !sheet) return
    const focusable = [
      ...sheet.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), input:not(:disabled)'
      )
    ].filter((element) => element.offsetParent !== null)
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && (document.activeElement === first || document.activeElement === sheet)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  // Clicking anywhere outside closes the dock. The trigger is exempt so its own
  // click can toggle instead of closing and immediately reopening.
  function onPointerDown(event: PointerEvent): void {
    if (!account.open) return
    // Right-clicks open the app menu elsewhere; they should not dismiss this.
    if (event.button !== 0) return
    const target = event.target
    if (!(target instanceof Element)) {
      account.close()
      return
    }
    if (sheet?.contains(target) || target.closest('[data-account-trigger]')) return
    account.close()
  }

  function switchMode(next: Mode): void {
    mode = next
    formError = ''
    notice = ''
  }

  async function submitCredentials(credentials: AccountCredentials): Promise<void> {
    formBusy = true
    formError = ''
    try {
      const result =
        mode === 'sign-up' ? await account.signUp(credentials) : await account.signIn(credentials)
      if (!result.ok) formError = result.error
    } finally {
      formBusy = false
    }
  }

  async function magicLink(email: string): Promise<void> {
    formBusy = true
    formError = ''
    try {
      const result = await account.sendMagicLink(email)
      if (!result.ok) formError = result.error
    } finally {
      formBusy = false
    }
  }

  async function resetPassword(email: string): Promise<void> {
    formBusy = true
    formError = ''
    try {
      const result = await account.resetPassword(email)
      if (result.ok) notice = `Password reset code sent to ${email}.`
      else formError = result.error
    } finally {
      formBusy = false
    }
  }

  async function resend(): Promise<void> {
    if (status.state !== 'pending-verification') return
    resendBusy = true
    resendError = ''
    notice = ''
    try {
      const result = await account.resend()
      if (result.ok) notice = 'A new code is on its way.'
      else resendError = result.error
    } finally {
      resendBusy = false
    }
  }

  async function submitCode(): Promise<void> {
    if (codeBusy) return
    codeError = ''
    const value = code.trim()
    if (!/^\d{6}$/.test(value)) {
      codeError = 'Enter the 6-digit code from the email.'
      return
    }
    codeBusy = true
    try {
      const result = await account.verifyCode(value)
      if (!result.ok) codeError = result.error
    } finally {
      codeBusy = false
    }
  }

  async function startOver(): Promise<void> {
    resendBusy = true
    resendError = ''
    try {
      const result = await account.signOut()
      if (!result.ok) resendError = result.error
      else {
        mode = 'sign-in'
        notice = ''
      }
    } finally {
      resendBusy = false
    }
  }

  async function syncNow(): Promise<void> {
    if (syncBusy) return
    syncBusy = true
    try {
      await account.syncNow()
    } finally {
      syncBusy = false
    }
  }

  async function exportLibrary(): Promise<void> {
    exportBusy = true
    exportError = ''
    exportNote = ''
    try {
      const result = await account.exportLibrary()
      if (result.ok) exportNote = result.data.path
      else exportError = result.error
    } finally {
      exportBusy = false
    }
  }

  async function signOut(): Promise<void> {
    signingOut = true
    signOutError = ''
    try {
      const result = await account.signOut()
      if (!result.ok) signOutError = result.error
    } finally {
      signingOut = false
    }
  }

  async function deleteAccount(): Promise<void> {
    if (!deleteReady || deleteBusy) return
    deleteBusy = true
    deleteError = ''
    try {
      const result = await account.deleteAccount()
      if (!result.ok) deleteError = result.error
      else {
        confirmingDelete = false
        deleteText = ''
      }
    } finally {
      deleteBusy = false
    }
  }

  async function savePassword(): Promise<void> {
    if (passwordBusy) return
    passwordError = ''
    passwordNotice = ''
    if (newPassword.length < 8) {
      passwordError = 'Use at least 8 characters.'
      return
    }
    if (newPassword !== confirmPassword) {
      passwordError = 'The passwords do not match.'
      return
    }
    passwordBusy = true
    try {
      const result = await account.updatePassword(newPassword)
      if (!result.ok) {
        passwordError = result.error
        return
      }
      newPassword = ''
      confirmPassword = ''
      passwordOpen = false
      passwordNotice = 'Password updated.'
    } finally {
      passwordBusy = false
    }
  }

  function cancelPassword(): void {
    passwordOpen = false
    newPassword = ''
    confirmPassword = ''
    passwordError = ''
    passwordNotice = ''
  }
</script>

<svelte:window onkeydown={onKeydown} onpointerdown={onPointerDown} />

{#snippet passwordForm()}
  <form
    class="password-form"
    onsubmit={(event) => {
      event.preventDefault()
      void savePassword()
    }}
  >
    <label>
      <span>New password</span>
      <input
        type="password"
        bind:value={newPassword}
        autocomplete="new-password"
        placeholder="At least 8 characters"
        disabled={passwordBusy}
      />
    </label>
    <label>
      <span>Confirm new password</span>
      <input
        type="password"
        bind:value={confirmPassword}
        autocomplete="new-password"
        disabled={passwordBusy}
      />
    </label>
    {#if passwordError}
      <p class="form-error" role="alert">{passwordError}</p>
    {/if}
    <div class="actions">
      <button type="submit" class="ghost" disabled={passwordBusy}>
        {passwordBusy ? 'Saving…' : 'Set new password'}
      </button>
      {#if status.state === 'signed-in'}
        <button type="button" class="ghost" onclick={cancelPassword} disabled={passwordBusy}>
          Cancel
        </button>
      {/if}
    </div>
  </form>
  {#if passwordNotice}
    <p class="notice" role="status">
      <Icon name="check" size={12} /> {passwordNotice}
    </p>
  {/if}
{/snippet}

{#if account.open}
  <div
    class="sheet"
    role="dialog"
    aria-label="Account"
    tabindex="-1"
    bind:this={sheet}
  >
    <header class="sheet-head">
      <p class="eyebrow">Account</p>
      <button class="close" aria-label="Close account panel" onclick={close}>
        <Icon name="close" size={14} />
      </button>
    </header>

    <div class="sheet-body scroll">
      {#if status.state === 'signed-out'}
        <div class="intro">
          <h2>Sync your library</h2>
          <p>
            Favourites, playlists, saved albums, history and a few settings, on every device you
            sign in to. Optional — Viby works fully without an account.
          </p>
        </div>

        <div class="tabs" role="group" aria-label="Account access">
          <button
            class:on={mode === 'sign-in'}
            aria-pressed={mode === 'sign-in'}
            onclick={() => switchMode('sign-in')}
          >
            Sign in
          </button>
          <button
            class:on={mode === 'sign-up'}
            aria-pressed={mode === 'sign-up'}
            onclick={() => switchMode('sign-up')}
          >
            Create account
          </button>
        </div>

        <SignInForm
          {mode}
          busy={formBusy}
          error={formError}
          onEdit={() => (formError = '')}
          onSubmit={submitCredentials}
          onMagicLink={magicLink}
          onReset={resetPassword}
        />

        {#if notice}
          <p class="notice" role="status">
            <Icon name="check" size={12} /> {notice}
          </p>
        {/if}

        <p class="privacy">
          While you are signed in, your library syncs through Viby's server, which stores it
          encrypted at rest and can read it to keep devices in step. Signed out, nothing is sent.
        </p>
      {:else if status.state === 'pending-verification'}
        <div class="intro">
          <h2>Enter your code</h2>
          <p>
            We sent a 6-digit code to <strong class="email">{status.email}</strong>. It expires
            shortly, so enter it here to finish.
          </p>
          <p class="hint-line">
            Already confirmed this address? Use <strong>Sign in instead</strong> below — a
            confirmation resend does nothing for a confirmed account.
          </p>
        </div>

        <form
          class="code-form"
          onsubmit={(event) => {
            event.preventDefault()
            void submitCode()
          }}
        >
          <input
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="6"
            pattern="[0-9]*"
            bind:value={code}
            aria-label="6-digit code"
            placeholder="123456"
            disabled={codeBusy}
          />
          <button class="ghost" type="submit" disabled={codeBusy || code.trim().length !== 6}>
            {codeBusy ? 'Checking…' : 'Confirm'}
          </button>
        </form>

        {#if codeError}
          <p class="form-error" role="alert">{codeError}</p>
        {/if}
        {#if notice}
          <p class="notice" role="status">
            <Icon name="check" size={12} /> {notice}
          </p>
        {/if}
        {#if resendError}
          <p class="form-error" role="alert">{resendError}</p>
        {/if}

        <div class="actions">
          <button class="ghost" onclick={resend} disabled={resendBusy || codeBusy}>
            {resendBusy ? 'Sending…' : 'Resend code'}
          </button>
          <button class="ghost" onclick={startOver} disabled={resendBusy}>Sign in instead</button>
        </div>
      {:else if status.state === 'recovery'}
        <div class="intro">
          <h2>Set a new password</h2>
          <p>
            The reset code signed <strong class="email">{status.email}</strong> in. Choose a new
            password to finish — syncing stays paused until you do.
          </p>
        </div>
        {@render passwordForm()}
      {:else}
        <div class="who">
          <span class="avatar" aria-hidden="true">{account.initial}</span>
          <div class="who-copy">
            <p class="eyebrow">Signed in</p>
            <p class="email" title={status.email}>{status.email}</p>
          </div>
        </div>

        <div
          class="sync"
          class:error={sync.phase === 'error'}
          class:offline={sync.phase === 'offline'}
        >
          <span class="sync-dot" class:busy={sync.phase === 'syncing'} aria-hidden="true"></span>
          <p aria-live="polite">{syncSummary(sync)}</p>
          <button
            class="ghost small"
            onclick={syncNow}
            disabled={syncBusy || sync.phase === 'syncing'}
          >
            {syncBusy || sync.phase === 'syncing' ? 'Syncing…' : 'Sync now'}
          </button>
        </div>

        <div class="action">
          <div class="action-copy">
            <span>Export library</span>
            <span class="hint">
              {#if exportError}
                {exportError}
              {:else if exportNote}
                Saved to <span class="path">{exportNote}</span>
              {:else}
                Write your library to a JSON file you can keep.
              {/if}
            </span>
          </div>
          <button class="ghost" onclick={exportLibrary} disabled={exportBusy}>
            {exportBusy ? 'Exporting…' : 'Export'}
          </button>
        </div>

        <div class="action">
          <div class="action-copy">
            <span>Password</span>
            <span class="hint">Set a new password for this account.</span>
          </div>
          <button class="ghost" onclick={() => (passwordOpen = !passwordOpen)}>
            {passwordOpen ? 'Close' : 'Change'}
          </button>
        </div>

        {#if passwordOpen}
          {@render passwordForm()}
        {/if}

        <div class="action">
          <div class="action-copy">
            <span>Sign out</span>
            <span class="hint">
              {#if signOutError}
                {signOutError}
              {:else}
                This device keeps its library; syncing stops until you sign in again.
              {/if}
            </span>
          </div>
          <button class="ghost" onclick={signOut} disabled={signingOut}>
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>

        <div class="danger">
          {#if confirmingDelete}
            <p class="danger-copy">
              This erases your account and the library stored on the server. Downloads and local
              files stay. Type <strong>{status.email}</strong> to confirm.
            </p>
            <input
              class="confirm"
              type="text"
              bind:value={deleteText}
              autocomplete="off"
              spellcheck="false"
              aria-label="Type your email address to confirm deletion"
              placeholder={status.email}
              disabled={deleteBusy}
            />
            {#if deleteError}
              <p class="form-error" role="alert">{deleteError}</p>
            {/if}
            <div class="actions">
              <button
                class="danger-solid"
                onclick={deleteAccount}
                disabled={!deleteReady || deleteBusy}
              >
                {deleteBusy ? 'Deleting…' : 'Delete forever'}
              </button>
              <button
                class="ghost"
                onclick={() => {
                  confirmingDelete = false
                  deleteText = ''
                  deleteError = ''
                }}
                disabled={deleteBusy}
              >
                Cancel
              </button>
            </div>
          {:else}
            <button class="link-danger" onclick={() => (confirmingDelete = true)} disabled={signingOut}>
              Delete account…
            </button>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .sheet {
    position: absolute;
    top: calc(100% + 10px);
    right: 0;
    z-index: 80;
    display: flex;
    flex-direction: column;
    width: 340px;
    max-width: calc(100vw - 32px);
    max-height: min(560px, calc(100vh - var(--titlebar-h) - var(--player-h) - 32px));
    border: 1px solid var(--stroke-strong);
    border-radius: var(--radius-lg);
    background: var(--glass-strong);
    backdrop-filter: blur(26px) saturate(150%);
    -webkit-backdrop-filter: blur(26px) saturate(150%);
    box-shadow: var(--shadow-dock);
    -webkit-app-region: no-drag;
    animation: account-in 160ms var(--ease);
  }

  .sheet:focus {
    outline: none;
  }

  @keyframes account-in {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
  }

  .sheet-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-shrink: 0;
    padding: 13px 12px 9px 16px;
  }

  .eyebrow {
    margin: 0;
    color: var(--text-faint);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .close {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    flex-shrink: 0;
    border-radius: 7px;
    color: var(--text-faint);
    transition:
      background var(--speed) var(--ease),
      color var(--speed) var(--ease);
  }

  .close:hover {
    background: var(--glass-hover);
    color: var(--text);
  }

  .sheet-body {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 0 16px 18px;
  }

  h2 {
    margin: 0 0 6px;
    font-size: 18px;
    font-weight: 620;
    letter-spacing: -0.025em;
    line-height: 1.2;
  }

  .intro p {
    margin: 0;
    color: var(--text-dim);
    font-size: 12.5px;
    line-height: 1.5;
    user-select: text;
  }

  .intro strong,
  .email {
    color: var(--text);
    font-weight: 560;
  }

  .tabs {
    display: flex;
    gap: 4px;
    padding: 3px;
    border: 1px solid var(--stroke);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.025);
  }

  .tabs button {
    flex: 1;
    height: 27px;
    border-radius: 999px;
    color: var(--text-dim);
    font-size: 11.5px;
    font-weight: 550;
    transition:
      background var(--speed) var(--ease),
      color var(--speed) var(--ease);
  }

  .tabs button:hover {
    color: var(--text);
  }

  .tabs button.on {
    background: var(--text);
    color: #08080b;
  }

  .notice {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    color: var(--text-dim);
    font-size: 11.5px;
    line-height: 1.45;
  }

  .privacy {
    margin: 0;
    padding-top: 11px;
    border-top: 1px solid var(--stroke);
    color: var(--text-faint);
    font-size: 11px;
    line-height: 1.5;
  }

  .form-error {
    margin: 0;
    color: var(--danger);
    font-size: 11.5px;
    line-height: 1.45;
    user-select: text;
  }

  .who {
    display: flex;
    align-items: center;
    gap: 11px;
    min-width: 0;
  }

  .avatar {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    flex-shrink: 0;
    border: 1px solid var(--stroke-strong);
    border-radius: 50%;
    background:
      radial-gradient(circle at 34% 28%, rgba(255, 255, 255, 0.16), transparent 62%),
      var(--glass);
    color: var(--text);
    font-size: 14px;
    font-weight: 600;
  }

  .who-copy {
    min-width: 0;
  }

  .who-copy .eyebrow {
    margin-bottom: 2px;
  }

  .email {
    margin: 0;
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sync {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 10px 9px 12px;
    border: 1px solid var(--stroke);
    border-radius: var(--radius);
    background: rgba(255, 255, 255, 0.02);
  }

  .sync p {
    flex: 1 1 auto;
    min-width: 0;
    margin: 0;
    color: var(--text-dim);
    font-size: 11.5px;
    line-height: 1.4;
  }

  .sync.error {
    border-color: rgba(255, 128, 128, 0.28);
  }

  .sync.error p {
    color: var(--danger);
  }

  .sync.offline {
    border-color: rgba(240, 196, 119, 0.24);
  }

  .sync.offline p {
    color: #f0c477;
  }

  .sync-dot {
    width: 6px;
    height: 6px;
    flex-shrink: 0;
    border-radius: 50%;
    background: #7ddc9a;
    box-shadow: 0 0 0 3px rgba(125, 220, 154, 0.1);
  }

  .sync.error .sync-dot {
    background: var(--danger);
    box-shadow: 0 0 0 3px rgba(255, 128, 128, 0.12);
  }

  .sync.offline .sync-dot {
    background: #f0c477;
    box-shadow: 0 0 0 3px rgba(240, 196, 119, 0.12);
  }

  .sync-dot.busy {
    animation: sync-pulse 1.1s var(--ease) infinite;
  }

  @keyframes sync-pulse {
    50% {
      opacity: 0.35;
    }
  }

  .action {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding-top: 12px;
    border-top: 1px solid var(--stroke);
  }

  .action-copy {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .action-copy > span:first-child {
    font-size: 12.5px;
  }

  .hint {
    color: var(--text-faint);
    font-size: 11px;
    line-height: 1.45;
    user-select: text;
  }

  .path {
    overflow-wrap: anywhere;
    user-select: text;
  }

  .ghost {
    flex-shrink: 0;
    padding: 6px 12px;
    border: 1px solid var(--stroke);
    border-radius: 999px;
    color: var(--text-dim);
    font-size: 11.5px;
    transition:
      background var(--speed) var(--ease),
      color var(--speed) var(--ease),
      border-color var(--speed) var(--ease);
  }

  .ghost:hover:not(:disabled) {
    border-color: var(--stroke-strong);
    background: var(--glass-hover);
    color: var(--text);
  }

  .ghost.small {
    padding: 5px 10px;
    font-size: 11px;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .danger {
    margin-top: 2px;
    padding-top: 12px;
    border-top: 1px solid var(--stroke);
  }

  .danger-copy {
    margin: 0 0 9px;
    color: var(--text-dim);
    font-size: 11.5px;
    line-height: 1.5;
    user-select: text;
  }

  .danger-copy strong {
    color: var(--text);
    font-weight: 560;
    overflow-wrap: anywhere;
  }

  .confirm {
    width: 100%;
    height: 32px;
    margin-bottom: 10px;
    padding: 0 10px;
    border: 1px solid rgba(255, 128, 128, 0.4);
    border-radius: var(--radius-sm);
    background: rgba(255, 128, 128, 0.05);
    color: var(--text);
    font-size: 12px;
    user-select: text;
  }

  .confirm::placeholder {
    color: var(--text-faint);
  }

  .confirm:focus-visible {
    border-color: var(--danger);
  }

  .password-form {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 12px;
    padding: 12px;
    border: 1px solid var(--stroke);
    border-radius: var(--radius-sm);
    background: var(--glass);
  }

  .code-form {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }

  .intro .hint-line {
    margin-top: 10px;
    color: var(--text-faint);
    font-size: 11.5px;
  }

  .code-form input {
    flex: 1;
    min-width: 0;
    height: 40px;
    padding: 0 12px;
    border: 1px solid var(--stroke);
    border-radius: var(--radius-sm);
    background: var(--glass);
    color: var(--text);
    font-size: 20px;
    font-weight: 600;
    letter-spacing: 8px;
    text-align: center;
    font-variant-numeric: tabular-nums;
    user-select: text;
  }

  .code-form input:focus-visible {
    border-color: var(--stroke-strong);
    outline: none;
  }

  .password-form label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    color: var(--text-dim);
    font-size: 11.5px;
  }

  .password-form input {
    height: 32px;
    padding: 0 10px;
    border: 1px solid var(--stroke);
    border-radius: var(--radius-sm);
    background: var(--glass-strong);
    color: var(--text);
    font-size: 12px;
    user-select: text;
  }

  .password-form input:focus-visible {
    border-color: var(--stroke-strong);
    outline: none;
  }

  .password-form .actions {
    justify-content: flex-end;
  }

  .danger-solid {
    height: 30px;
    padding: 0 14px;
    border-radius: 999px;
    background: var(--danger);
    color: #1a0808;
    font-size: 11.5px;
    font-weight: 600;
    transition: background var(--speed) var(--ease);
  }

  .danger-solid:hover:not(:disabled) {
    background: #ff9a9a;
  }

  .danger-solid:disabled {
    opacity: 0.4;
    background: var(--danger);
    color: #1a0808;
  }

  .link-danger {
    color: var(--text-faint);
    font-size: 11.5px;
    text-decoration: underline;
    text-decoration-color: transparent;
    text-underline-offset: 3px;
    transition:
      color var(--speed) var(--ease),
      text-decoration-color var(--speed) var(--ease);
  }

  .link-danger:hover:not(:disabled) {
    color: var(--danger);
    text-decoration-color: currentColor;
  }

  @media (prefers-reduced-motion: reduce) {
    .sheet,
    .sync-dot.busy {
      animation: none;
    }
  }
</style>
