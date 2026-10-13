/** Domain error with an HTTP status and a message safe to show people. No framework imports. */
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
