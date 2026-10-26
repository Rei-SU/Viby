<script lang="ts">
  import Icon from './Icon.svelte'

  let {
    title,
    message,
    actionLabel,
    onAction
  }: {
    title: string
    message: string
    actionLabel?: string
    onAction?: () => void
  } = $props()
</script>

<div class="alert">
  <span class="mark" aria-hidden="true"><Icon name="alert" size={15} /></span>
  <div class="copy" role="alert">
    <strong>{title}</strong>
    <span>{message}</span>
  </div>
  {#if actionLabel}
    <button class="action" onclick={onAction}>{actionLabel}</button>
  {/if}
</div>

<style>
  .alert {
    display: flex;
    align-items: flex-start;
    gap: 11px;
    padding: 12px 14px;
    border: 1px solid rgba(255, 128, 128, 0.18);
    border-radius: var(--radius);
    background: linear-gradient(180deg, rgba(255, 128, 128, 0.055), rgba(255, 128, 128, 0.025));
    box-shadow: inset 2px 0 0 rgba(255, 128, 128, 0.6);
    font-size: 12.5px;
  }

  .mark {
    display: flex;
    padding-top: 1px;
    color: var(--danger);
  }

  .copy {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  .copy strong {
    color: var(--text);
    font-weight: 600;
  }

  .copy span {
    color: var(--text-dim);
    line-height: 1.45;
    overflow-wrap: anywhere;
    user-select: text;
  }

  .action {
    flex-shrink: 0;
    align-self: center;
    padding: 5px 11px;
    border: 1px solid var(--stroke);
    border-radius: 999px;
    color: var(--text);
    font-size: 11.5px;
    transition:
      background var(--speed) var(--ease),
      border-color var(--speed) var(--ease);
  }

  .action:hover {
    border-color: var(--stroke-strong);
    background: var(--glass-hover);
  }
</style>
