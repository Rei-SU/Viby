<script lang="ts">
  import type { DownloadJobState, DownloadJobView } from '@shared/types'
  import { downloads } from '../lib/downloads.svelte'
  import { groupDownloadJobs, type DownloadJobGroup } from '../lib/download-jobs'
  import { nav } from '../lib/nav.svelte'
  import { sidePanel } from '../lib/side-panel.svelte'
  import Cover from './Cover.svelte'
  import Icon from './Icon.svelte'

  const groups = $derived(groupDownloadJobs(downloads.snapshot, downloads.jobs))

  function statusLabel(state: DownloadJobState): string {
    switch (state) {
      case 'downloading':
        return 'Downloading'
      case 'queued':
        return 'Queued'
      case 'paused':
        return 'Paused'
      case 'failed':
        return 'Failed'
    }
  }

  function groupMeta(group: DownloadJobGroup): string {
    const count =
      group.collection && group.total > 0
        ? `${group.done}/${group.total}`
        : `${group.jobs.length} pending`
    return `${count} · ${statusLabel(group.state)}`
  }

  function jobMeta(job: DownloadJobView): string {
    return job.state === 'downloading' ? `${Math.round(job.percent ?? 0)}%` : statusLabel(job.state)
  }

  function cancelGroup(group: DownloadJobGroup): void {
    if (group.cancelKey) void downloads.cancelCollection(group.cancelKey)
  }

  function openLibrary(): void {
    sidePanel.close()
    nav.go('library')
  }

  function pauseGroup(group: DownloadJobGroup): void {
    if (group.cancelKey) void downloads.pauseCollection(group.cancelKey)
  }

  function resumeGroup(group: DownloadJobGroup): void {
    if (group.cancelKey) void downloads.resumeCollection(group.cancelKey)
  }
</script>

<div class="downloads scroll">
  {#if downloads.error}
    <p class="error">{downloads.error}</p>
  {/if}

  {#if groups.length === 0}
    <p class="empty">
      {downloads.loading ? 'Loading downloads…' : 'No downloads in progress.'}
    </p>
  {:else}
    {#each groups as group (group.key)}
      <section class="group">
        <div class="group-head">
          {#if group.thumbnail}
            <Cover src={group.thumbnail} size={30} radius={7} alt={group.title} />
          {/if}
          <div class="group-text">
            <span class="group-title truncate">{group.title}</span>
            <span class="group-meta">{groupMeta(group)}</span>
          </div>
          {#if group.cancelKey}
            {#if group.state === 'paused'}
              <button
                class="group-cancel"
                title="Resume this collection's paused downloads"
                onclick={() => resumeGroup(group)}
              >
                Resume
              </button>
            {:else if group.state === 'downloading' || group.state === 'queued'}
              <button
                class="group-cancel"
                title="Pause this collection's remaining downloads"
                onclick={() => pauseGroup(group)}
              >
                Pause
              </button>
            {/if}
            <button
              class="group-cancel"
              title="Cancel the remaining downloads in this collection"
              onclick={() => cancelGroup(group)}
            >
              Cancel
            </button>
          {/if}
        </div>

        {#if group.state === 'downloading' && group.percent > 0}
          <div class="bar" aria-hidden="true"><span style="width: {group.percent}%"></span></div>
        {/if}

        <ul class="jobs">
          {#each group.jobs as job (job.trackId)}
            <li>
              <span class="job-title truncate">{job.track.title}</span>
              <span class="job-meta">{jobMeta(job)}</span>
              {#if job.state === 'failed'}
                <button
                  class="job-action retry"
                  title={job.error ?? 'Retry download'}
                  onclick={() => void downloads.retry(job.trackId)}
                >
                  Retry
                </button>
              {:else}
                {#if job.state === 'paused'}
                  <button
                    class="job-action"
                    title="Resume download"
                    aria-label={`Resume ${job.track.title}`}
                    onclick={() => void downloads.resume(job.trackId)}
                  >
                    <Icon name="play" size={11} />
                  </button>
                {:else}
                  <button
                    class="job-action"
                    title="Pause download"
                    aria-label={`Pause ${job.track.title}`}
                    onclick={() => void downloads.pause(job.trackId)}
                  >
                    <Icon name="pause" size={11} />
                  </button>
                {/if}
                <button
                  class="job-action"
                  title="Cancel download"
                  aria-label={`Cancel ${job.track.title}`}
                  onclick={() => void downloads.cancel(job.trackId)}
                >
                  <Icon name="close" size={13} />
                </button>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  {/if}

  <button class="library" onclick={openLibrary}>Open Library</button>
</div>

<style>
  .downloads {
    flex: 1;
    min-height: 0;
    padding: 2px 10px 16px;
    display: flex;
    flex-direction: column;
  }

  .empty {
    margin: 0;
    padding: 8px 10px;
    color: var(--text-faint);
    font-size: 13px;
    line-height: 1.5;
  }

  .error {
    margin: 4px 10px;
    color: var(--danger);
    font-size: 11.5px;
    line-height: 1.4;
  }

  .group {
    padding: 10px 8px 8px;
    border-radius: 10px;
  }

  .group + .group {
    border-top: 1px solid var(--stroke);
    border-radius: 0;
  }

  .group-head {
    display: flex;
    align-items: center;
    gap: 9px;
  }

  .group-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .group-title {
    font-size: 12.5px;
    font-weight: 550;
  }

  .group-meta {
    color: var(--text-faint);
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
  }

  .group-cancel {
    flex-shrink: 0;
    padding: 3px 8px;
    border: 1px solid var(--stroke);
    border-radius: 999px;
    color: var(--text-dim);
    font-size: 10.5px;
    transition:
      background var(--speed) var(--ease),
      color var(--speed) var(--ease),
      border-color var(--speed) var(--ease);
  }

  .group-cancel:hover {
    border-color: var(--stroke-strong);
    background: var(--glass-hover);
    color: var(--text);
  }

  .bar {
    height: 2px;
    margin: 8px 0 2px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.12);
    overflow: hidden;
  }

  .bar span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--text);
    transition: width var(--speed) var(--ease);
  }

  .jobs {
    list-style: none;
    margin: 0;
    padding: 4px 0 0 39px;
    display: flex;
    flex-direction: column;
  }

  .jobs li {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 26px;
  }

  .job-title {
    flex: 1;
    min-width: 0;
    color: var(--text-dim);
    font-size: 11.5px;
  }

  .job-meta {
    flex-shrink: 0;
    color: var(--text-faint);
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
  }

  .job-action {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 6px;
    color: var(--text-faint);
    flex-shrink: 0;
    transition:
      background var(--speed) var(--ease),
      color var(--speed) var(--ease);
  }

  .job-action:hover {
    background: var(--glass-hover);
    color: var(--text);
  }

  .job-action.retry {
    width: auto;
    padding: 0 7px;
    font-size: 10.5px;
  }

  .library {
    align-self: flex-start;
    margin: 12px 8px 0;
    padding: 7px 12px;
    border: 1px solid var(--stroke);
    border-radius: 999px;
    color: var(--text-dim);
    font-size: 11.5px;
    transition:
      background var(--speed) var(--ease),
      color var(--speed) var(--ease),
      border-color var(--speed) var(--ease);
  }

  .library:hover {
    border-color: var(--stroke-strong);
    background: var(--glass-hover);
    color: var(--text);
  }
</style>
