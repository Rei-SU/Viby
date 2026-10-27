<script lang="ts">
  type IconName =
    | 'play'
    | 'pause'
    | 'prev'
    | 'next'
    | 'shuffle'
    | 'repeat'
    | 'volume'
    | 'mute'
    | 'heart'
    | 'plus'
    | 'list'
    | 'home'
    | 'search'
    | 'download'
    | 'back'
    | 'forward'
    | 'close'
    | 'check'
    | 'grip'
    | 'alert'
    | 'note'
    | 'disc'
    | 'lyrics'
    | 'gear'
    | 'clock'
    | 'user'

  let {
    name,
    size = 18,
    solid
  }: { name: IconName; size?: number; solid?: boolean } = $props()

  // Kept as path data so there is no icon dependency and nothing to load.
  const ICONS: Record<IconName, { d: string; solid?: boolean }> = {
    play: { d: 'M7 4.5l12 7.5-12 7.5v-15z', solid: true },
    pause: { d: 'M7 4h3.6v16H7zM13.4 4H17v16h-3.6z', solid: true },
    prev: { d: 'M6 5v14M18 5l-9 7 9 7V5z', solid: true },
    next: { d: 'M18 5v14M6 5l9 7-9 7V5z', solid: true },
    shuffle: { d: 'M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5' },
    repeat: { d: 'M17 2l4 4-4 4M3 11V9a4 4 0 014-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 01-4 4H3' },
    volume: {
      d: 'M11 5L6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13'
    },
    mute: { d: 'M11 5L6 9H2v6h4l5 4V5zM22 9l-6 6M16 9l6 6' },
    heart: {
      d: 'M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 00-7.8 7.8L12 21.2l8.8-8.8a5.5 5.5 0 000-7.8z'
    },
    plus: { d: 'M12 5v14M5 12h14' },
    list: { d: 'M4 6h16M4 12h16M4 18h10' },
    home: { d: 'M3 10.5L12 3l9 7.5V21H3zM9 21v-7h6v7' },
    search: { d: 'M11 4a7 7 0 100 14 7 7 0 000-14zM16.5 16.5L21 21' },
    download: { d: 'M12 3v12M7 10l5 5 5-5M5 21h14' },
    back: { d: 'M15 18l-6-6 6-6' },
    forward: { d: 'M9 18l6-6-6-6' },
    close: { d: 'M18 6L6 18M6 6l12 12' },
    check: { d: 'M5 12.5l4.5 4.5L19 7.5' },
    grip: { d: 'M9 6h1.5M14 6h1.5M9 12h1.5M14 12h1.5M9 18h1.5M14 18h1.5' },
    alert: { d: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7.5v5.5M12 16.5h.01' },
    note: {
      d: 'M9 18V5l12-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0zM21 16a3 3 0 11-6 0 3 3 0 016 0z'
    },
    disc: { d: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 10a2 2 0 100 4 2 2 0 000-4z' },
    lyrics: {
      d: 'M4 5.5A1.5 1.5 0 015.5 4h13A1.5 1.5 0 0120 5.5v9a1.5 1.5 0 01-1.5 1.5H10l-4.5 4v-4H5.5A1.5 1.5 0 014 14.5zM8 8.5h8M8 11.5h5'
    },
    gear: {
      d: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z'
    },
    clock: { d: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2' },
    user: { d: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0' }
  }

  const icon = $derived(ICONS[name])
  const filled = $derived(solid ?? icon.solid ?? false)
</script>

<svg
  viewBox="0 0 24 24"
  width={size}
  height={size}
  fill={filled ? 'currentColor' : 'none'}
  stroke={filled ? 'none' : 'currentColor'}
  stroke-width="1.7"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false"
>
  <path d={icon.d} />
</svg>
