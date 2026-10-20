/** A user-facing import failure. The message is shown in the Import page. */
export class ImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportError'
  }
}
