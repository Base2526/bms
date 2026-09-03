export class SignupRequestTimeout extends Error {
  constructor() {
    super("Signup request timed out");
    this.name = "SignupRequestTimeout";
  }
}

/** Bound the UI wait even if the network never settles. Aborting the browser
 * request does not undo server work, so callers must describe an unknown outcome. */
export async function runSignupRequest<T>(
  request: (signal: AbortSignal) => Promise<T>,
  timeoutMs = 45_000,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new SignupRequestTimeout());
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([request(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
