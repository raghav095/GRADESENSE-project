// A raw `res.json()` throws the browser's own low-level parse exception
// ("Failed to execute 'json' on 'Response': Unexpected end of JSON input")
// whenever the body is empty or not valid JSON — which happens for reasons
// that have nothing to do with the request itself: the dev server restarting
// mid-request (tsx watch picking up a file save), a dropped connection, a
// proxy error page. That raw exception message was surfacing verbatim in the
// UI, unintelligible to whoever's using the app. Reading the body as text
// first (which never throws on empty) lets us report a message that
// describes what actually happened instead.
export async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) {
    throw new Error(`The server returned an empty response (status ${res.status}). It may have restarted mid-request — please try again.`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`The server returned an unreadable response (status ${res.status}). It may have restarted mid-request — please try again.`);
  }
}
