import asyncio, sys, json
from playwright.async_api import async_playwright

URL = "http://localhost:3100/call/meeting-e2e-" + sys.argv[1] if len(sys.argv)>1 else "http://localhost:3100/call/meeting-e2e-a"
ARGS = ["--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream","--autoplay-policy=no-user-gesture-required"]

NOCAM = """
const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
navigator.mediaDevices.getUserMedia = (c) => {
  if (c && c.video) return Promise.reject(new DOMException('no cam','NotFoundError'));
  return orig(c);
};
"""

async def video_report(page, label):
    return await page.evaluate("""() => [...document.querySelectorAll('.imr-tile')].map(t => {
      const v = t.querySelector('video');
      return { name: t.querySelector('.imr-name')?.textContent?.trim(), on: v.classList.contains('on'), w: v.videoWidth, h: v.videoHeight,
               paused: v.paused, avatar: !!t.querySelector('.imr-avatar'), connecting: !!t.querySelector('.imr-connecting') };
    })""")

async def join(ctx, name, nocam=False):
    page = await ctx.new_page()
    page.on("pageerror", lambda e: print("PAGEERROR", name, e))
    if nocam: await page.add_init_script(NOCAM)
    await page.goto(URL)
    await page.fill(".imr-field input", name)
    await page.click(".imr-join")
    return page

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=ARGS)
        ctxA = await browser.new_context(permissions=["camera","microphone"])
        ctxB = await browser.new_context(permissions=["camera","microphone"])
        ctxC = await browser.new_context(permissions=["camera","microphone"])
        A = await join(ctxA, "Abhi Host")
        await A.wait_for_selector(".imr-live", timeout=15000)
        print("A live (host)")
        B = await join(ctxB, "Guest Bee")
        await B.wait_for_selector("text=Waiting for", timeout=15000)
        print("B is in waiting room")
        await A.wait_for_selector(".imr-alert", timeout=10000)
        await A.click(".imr-alert button.primary")   # Admit all
        await B.wait_for_selector(".imr-live", timeout=15000)
        print("B admitted")
        await asyncio.sleep(6)
        print("A sees:", json.dumps(await video_report(A,"A")))
        print("B sees:", json.dumps(await video_report(B,"B")))

        # Third person with NO camera (the asymmetric-negotiation case)
        C = await join(ctxC, "Chai NoCam", nocam=True)
        await C.wait_for_selector("text=Waiting for", timeout=15000)
        await A.wait_for_selector(".imr-alert", timeout=10000)
        await A.click(".imr-alert button.primary")
        await C.wait_for_selector(".imr-live", timeout=15000)
        await asyncio.sleep(7)
        print("A sees:", json.dumps(await video_report(A,"A")))
        print("B sees:", json.dumps(await video_report(B,"B")))
        print("C sees:", json.dumps(await video_report(C,"C")))

        # mute/hand state sync + chat
        await B.click('button[aria-label^="Microphone"]')
        await B.click('button[aria-label^="Raise hand"]')
        await asyncio.sleep(1.5)
        a_state = await A.evaluate("""() => [...document.querySelectorAll('.imr-tile')].map(t => ({n:t.querySelector('.imr-name')?.textContent?.trim(), muted: !!t.querySelector('.imr-tile-icons .muted'), hand: !!t.querySelector('.imr-hand')}))""")
        print("A sees states:", json.dumps(a_state))
        await B.click('button[aria-label="Chat (C)"]')
        await B.fill(".imr-compose input", "hello from B")
        await B.press(".imr-compose input", "Enter")
        await A.click('button[aria-label="Chat (C)"]')
        await asyncio.sleep(1)
        print("A chat:", await A.evaluate("() => [...document.querySelectorAll('.imr-msg')].map(m=>m.innerText.replace(/\\n/g,' | '))"))

        # B turns camera off then on -> A's tile should follow
        await B.click('button[aria-label^="Camera"]')
        await asyncio.sleep(1.5)
        off = await A.evaluate("() => { const t=[...document.querySelectorAll('.imr-tile')].find(t=>t.innerText.includes('Guest Bee')); return !!t.querySelector('.imr-avatar'); }")
        await B.click('button[aria-label^="Camera"]')
        await asyncio.sleep(3)
        print("cam off -> avatar shown on A:", off)
        print("after cam on, A sees:", json.dumps(await video_report(A,"A")))

        # screen share spotlight (headless may reject getDisplayMedia; try)
        # B leaves -> A updates
        await B.click('button[aria-label="Leave meeting"]')
        await asyncio.sleep(1.5)
        print("after B leaves, A tiles:", len(await video_report(A,"A")))
        await browser.close()
asyncio.run(main())
