# Account + guest + audio/video end-to-end check. Needs: pip install playwright && playwright install chromium,
# a running server on :3100 with DATABASE_URL set and migrations applied (pnpm db:push).
import asyncio, json, time
from playwright.async_api import async_playwright
BASE="http://localhost:3100"
ARGS=["--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream","--autoplay-policy=no-user-gesture-required"]
HOOK="""(()=>{const O=window.RTCPeerConnection;window.__pcs=[];window.RTCPeerConnection=function(...a){const pc=new O(...a);window.__pcs.push(pc);return pc};window.RTCPeerConnection.prototype=O.prototype;})();"""
STATS="""async()=>{const out=[];for(const pc of window.__pcs){const r=await pc.getStats();r.forEach(s=>{if(s.type==='inbound-rtp')out.push({dir:'in',kind:s.kind,packets:s.packetsReceived,energy:+(s.totalAudioEnergy||0).toFixed(4),frames:s.framesDecoded||0});if(s.type==='outbound-rtp')out.push({dir:'out',kind:s.kind,packets:s.packetsSent})})}return out}"""
TILES="""()=>[...document.querySelectorAll('.imr-tile')].map(t=>{const v=t.querySelector('video');return{name:t.querySelector('.imr-name')?.textContent?.trim(),video:v.classList.contains('on')&&v.videoWidth>0,res:v.videoWidth+'x'+v.videoHeight,playing:!v.paused,audioUnmuted:!v.muted}})"""
def trpc(route,payload): return dict(data=json.dumps({"0":{"json":payload}}), headers={"content-type":"application/json"})
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(args=ARGS)
        host=await b.new_context(permissions=["camera","microphone"]); guest=await b.new_context(permissions=["camera","microphone"])
        stamp=int(time.time())
        r=await host.request.post(f"{BASE}/api/trpc/auth.register?batch=1", **trpc("r",{"name":"Abhi Raj","email":f"abhi{stamp}@example.test","password":"Demo-password-2026!"}))
        print("register:", r.status)
        when=time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(time.time()+3600))
        r=await host.request.post(f"{BASE}/api/trpc/meetings.create?batch=1", **trpc("m",{"title":"Sprint review","scheduledAt":when,"durationMinutes":60}))
        mj=(await r.json())[0]["result"]["data"]["json"]; mid=mj["id"]; print("meeting created, id =", mid)
        link=f"{BASE}/call/meeting--{mid}"
        A=await host.new_page(); A.on("pageerror", lambda e: print("A pageerror",e)); await A.add_init_script(HOOK)
        await A.goto(link); await A.wait_for_selector(".imr-field input")
        print("host name prefilled from account:", await A.input_value(".imr-field input"))
        await A.click(".imr-join"); await A.wait_for_selector(".imr-live")
        B=await guest.new_page(); B.on("pageerror", lambda e: print("B pageerror",e)); await B.add_init_script(HOOK)
        await B.goto(link); await B.fill(".imr-field input","Priya Guest"); await B.click(".imr-join")
        await B.wait_for_selector("text=Waiting for"); await A.wait_for_selector(".imr-alert"); await A.click(".imr-alert button.primary"); await B.wait_for_selector(".imr-live")
        print("guest (NO account) admitted via saved-meeting link")
        await asyncio.sleep(9)
        for n,pg in (("HOST",A),("GUEST",B)):
            print(n,"tiles :",json.dumps(await pg.evaluate(TILES)))
            st=await pg.evaluate(STATS)
            ain=[s for s in st if s["dir"]=="in" and s["kind"]=="audio"]; vin=[s for s in st if s["dir"]=="in" and s["kind"]=="video"]
            aout=[s for s in st if s["dir"]=="out" and s["kind"]=="audio"]; vout=[s for s in st if s["dir"]=="out" and s["kind"]=="video"]
            print(n,"AUDIO received:",ain,"| sent:",aout)
            print(n,"VIDEO received:",vin,"| sent:",vout)
        # invalid meeting link
        C=await guest.new_page(); await C.goto(f"{BASE}/call/meeting--999999"); await asyncio.sleep(2)
        print("invalid link message:", (await C.inner_text(".call-status")).strip())
        await b.close()
asyncio.run(main())
