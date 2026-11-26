<script lang="ts">
  import type { AccountCredentials } from '@shared/account'

  type Mode = 'sign-in' | 'sign-up'

  let {
    mode = 'sign-in',
    allowMagicLink = true,
    busy = false,
    error = '',
    onSubmit,
    onMagicLink,
    onReset,
    onEdit
  }: {
    mode?: Mode
    allowMagicLink?: boolean
    busy?: boolean
    error?: string
    onSubmit: (credentials: AccountCredentials) => void | Promise<void>
    onMagicLink?: (email: string) => void | Promise<void>
    onReset?: (email: string) => void | Promise<void>
    onEdit?: () => void
  } = $props()

  // The link path is a mode of its own: email only, no password field.
  let linkMode = $state(false)
  let email = $state('')
  let password = $state('')
  let emailError = $state('')
  let passwordError = $state('')
  let submitting = $state(false)

  let emailInput = $state<HTMLInputElement>()
  let passwordInput = $state<HTMLInputElement>()

  const working = $derived(busy || submitting)
  const heading = $derived(
    linkMode ? 'Sign in by email' : mode === 'sign-up' ? 'Create your account' : 'Welcome back'
  )

  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

  // Switching between sign in and create account always returns to the
  // password form; a link form left open on the other tab would be confusing.
  $effect(() => {
    if (mode === 'sign-in' || mode === 'sign-up') linkMode = false
  })

  function checkEmail(value: string): string {
    const address = value.trim()
    if (!address) return 'Enter your email address.'
    if (!EMAIL.test(address)) return "That email address doesn't look right."
    return ''
  }

  function checkPassword(value: string): string {
    if (!value) return 'Enter your password.'
    // Matches the service's minimum for new accounts; sign-in accepts older
    // passwords that were created before that rule.
    if (mode === 'sign-up' && value.length < 8) return 'Use at least 8 characters.'
    return ''
  }

  function edited(): void {
    emailError = ''
    passwordError = ''
    onEdit?.()
  }

  function focusFirstProblem(): void {
    if (emailError) emailInput?.focus()
    else if (passwordError) passwordInput?.focus()
  }

  async function submitCredentials(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    if (working) return

    emailError = checkEmail(email)
    passwordError = checkPassword(password)
    if (emailError || passwordError) {
      focusFirstProblem()
      return
    }

    submitting = true
    try {
      await onSubmit({ email: email.trim(), password })
    } finally {
      submitting = false
    }
  }

  async function submitLink(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    if (working || !onMagicLink) return

    emailError = checkEmail(email)
    if (emailError) {
      focusFirstProblem()
      return
    }

    submitting = true
    try {
      await onMagicLink(email.trim())
    } finally {
      submitting = false
    }
  }

  function switchToLink(): void {
    linkMode = true
    passwordError = ''
    edited()
  }

  function switchToPassword(): void {
    linkMode = false
    edited()
  }

  async function reset(): Promise<void> {
    if (!onReset || working) return
    emailError = checkEmail(email)
    if (emailError) {
      focusFirstProblem()
      return
    }
    submitting = true
    try {
      await onReset(email.trim())
    } finally {
      submitting = false
    }
  }
</script>

{#if linkMode}
  <form onsubmit={submitLink} novalidate aria-busy={working}>
    <p class="lead">
      We'll email a one-time code. Enter it here to sign in — no password to remember.
    </p>

    <div class="field">
      <label for="account-link-email">Email</label>
      <input
        id="account-link-email"
        bind:this={emailInput}
        bind:value={email}
        type="email"
        name="email"
        autocomplete="email"
        spellcheck="false"
        placeholder="you@example.com"
        aria-invalid={emailError ? 'true' : undefined}
        aria-describedby={emailError ? 'account-link-email-error' : undefined}
        disabled={working}
        oninput={edited}
      />
      {#if emailError}
        <p class="field-error" id="account-link-email-error">{emailError}</p>
      {/if}
    </div>

    <button class="solid" type="submit" disabled={working}>
      {working ? 'Sending…' : 'Email me a code'}
    </button>

    {#if error}
      <p class="form-error" role="alert">{error}</p>
    {/if}

    <button class="link" type="button" onclick={switchToPassword} disabled={working}>
      Use a password instead
    </button>
  </form>
{:else}
  <form onsubmit={submitCredentials} novalidate aria-busy={working}>
    <p class="lead">
      {mode === 'sign-up'
        ? 'The address receives a confirmation code before your first sync.'
        : 'Sign in to bring this device in line with your other ones.'}
    </p>

    <div class="field">
      <label for="account-email">Email</label>
      <input
        id="account-email"
        bind:this={emailInput}
        bind:value={email}
        type="email"
        name="email"
        autocomplete="email"
        spellcheck="false"
        placeholder="you@example.com"
        aria-invalid={emailError ? 'true' : undefined}
        aria-describedby={emailError ? 'account-email-error' : undefined}
        disabled={working}
        oninput={edited}
      />
      {#if emailError}
        <p class="field-error" id="account-email-error">{emailError}</p>
      {/if}
    </div>

    <div class="field">
      <label for="account-password">Password</label>
      <input
        id="account-password"
        bind:this={passwordInput}
        bind:value={password}
        type="password"
        name="password"
        autocomplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
        placeholder={mode === 'sign-up' ? 'At least 8 characters' : 'Your password'}
        aria-invalid={passwordError ? 'true' : undefined}
        aria-describedby={passwordError ? 'account-password-error' : undefined}
        disabled={working}
        oninput={edited}
      />
      {#if passwordError}
        <p class="field-error" id="account-password-error">{passwordError}</p>
      {/if}
    </div>

    <button class="solid" type="submit" disabled={working}>
      {#if working}
        {mode === 'sign-up' ? 'Creating…' : 'Signing in…'}
      {:else}
        {mode === 'sign-up' ? 'Create account' : 'Sign in'}
      {/if}
    </button>

    {#if error}
      <p class="form-error" role="alert">{error}</p>
    {/if}

    <div class="links">
      {#if allowMagicLink}
        <button class="link" type="button" onclick={switchToLink} disabled={working}>
          Email me a sign-in code
        </button>
      {/if}
      {#if mode === 'sign-in' && onReset}
        <button class="link" type="button" onclick={reset} disabled={working}>
          Forgot password?
        </button>
      {/if}
    </div>
  </form>
{/if}

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: 13px;
  }

  .lead {
    margin: 0;
    color: var(--text-dim);
    font-size: 12.5px;
    line-height: 1.5;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  label {
    color: var(--text-dim);
    font-size: 11.5px;
    font-weight: 550;
  }

  input {
    width: 100%;
    height: 34px;
    padding: 0 11px;
    border: 1px solid var(--stroke);
    border-radius: var(--radius-sm);
    background: rgba(255, 255, 255, 0.035);
    color: var(--text);
    font-size: 12.5px;
    user-select: text;
    transition: border-color var(--speed) var(--ease);
  }

  input::placeholder {
    color: var(--text-faint);
  }

  input:hover:not(:disabled) {
    border-color: var(--stroke-strong);
  }

  input:focus-visible {
    border-color: var(--accent-ring);
  }

  input[aria-invalid='true'] {
    border-color: rgba(255, 128, 128, 0.55);
  }

  input:disabled {
    opacity: 0.6;
  }

  .field-error,
  .form-error {
    margin: 0;
    color: var(--danger);
    font-size: 11.5px;
    line-height: 1.45;
    user-select: text;
  }

  .field-error {
    margin-top: -1px;
  }

  .solid {
    height: 34px;
    margin-top: 2px;
    border-radius: 999px;
    background: var(--accent);
    color: #08080b;
    font-size: 12.5px;
    font-weight: 600;
    transition: background var(--speed) var(--ease);
  }

  .solid:hover:not(:disabled) {
    background: var(--accent-strong);
  }

  .solid:disabled {
    opacity: 0.55;
    background: var(--accent);
    color: #08080b;
  }

  .links {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }

  .link {
    align-self: flex-start;
    color: var(--text-faint);
    font-size: 11.5px;
    text-decoration: underline;
    text-decoration-color: transparent;
    text-underline-offset: 3px;
    transition:
      color var(--speed) var(--ease),
      text-decoration-color var(--speed) var(--ease);
  }

  .link:hover:not(:disabled) {
    color: var(--text-dim);
    text-decoration-color: currentColor;
  }
</style>
