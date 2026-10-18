import { TURNSTILE_SITE_KEY } from './auth-config';

let tsPromise: Promise<void> | null = null;

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

const api = () => (window as any).turnstile as TurnstileApi | undefined;

/**
 * โหลดสคริปต์ Cloudflare Turnstile ครั้งเดียวแล้วแชร์ promise (แบบเดียวกับ loadGoogleIdentity)
 * ใช้ render=explicit เพราะ widget จะถูกวาดเฉพาะตอน backend ตอบ 428 CAPTCHA_REQUIRED เท่านั้น
 */
export function loadTurnstile(): Promise<void> {
  if (api()) return Promise.resolve();
  if (tsPromise) return tsPromise;

  tsPromise = new Promise<void>((resolve, reject) => {
    const done = () => (api() ? resolve() : reject(new Error('Turnstile not available')));
    let script = document.getElementById('cf-turnstile-script') as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement('script');
      script.id    = 'cf-turnstile-script';
      script.src   = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    script.addEventListener('load', done, { once: true });
    script.addEventListener('error', () => reject(new Error('โหลด CAPTCHA ไม่สำเร็จ')), { once: true });
  }).catch(err => {
    tsPromise = null;             // ให้ลองใหม่ได้รอบหน้า
    document.getElementById('cf-turnstile-script')?.remove();
    throw err;
  });
  return tsPromise;
}

export interface TurnstileHandlers {
  onToken:   (token: string) => void;
  onExpired: () => void;
  onError:   () => void;
}

/** วาด widget ลงใน el แล้วคืน widgetId (ใช้กับ resetTurnstile / removeTurnstile) */
export async function renderTurnstile(el: HTMLElement, h: TurnstileHandlers): Promise<string> {
  await loadTurnstile();
  return api()!.render(el, {
    sitekey:            TURNSTILE_SITE_KEY,
    language:           'th',
    theme:              'light',
    callback:           h.onToken,
    'expired-callback': h.onExpired,
    'error-callback':   h.onError,
  });
}

export function resetTurnstile(widgetId: string | null): void {
  if (widgetId) try { api()?.reset(widgetId); } catch {}
}

export function removeTurnstile(widgetId: string | null): void {
  if (widgetId) try { api()?.remove(widgetId); } catch {}
}
