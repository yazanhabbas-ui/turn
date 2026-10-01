"use client";

import { Header, Places, NowServing, RecentCalls, Slides, Ticker, WaitingBoard, type LayoutProps } from "./parts";

/** Classic bank board: a row per desk on one side, the latest call and waiting counts on the other. */
function Classic(p: LayoutProps) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[1.35fr_1fr] gap-[2vw] px-[3vw] pb-[2vh]">
      <Places {...p} />
      <div className="grid min-h-0 grid-rows-[41vh_1fr] gap-[1.6vh]">
        <div className="min-h-0">
          <NowServing {...p} />
        </div>
        <div className="grid min-h-0 content-start gap-[1.6vh] overflow-hidden">
          <RecentCalls {...p} max={2} />
          <WaitingBoard {...p} rows={3} />
        </div>
      </div>
    </div>
  );
}

/** One giant number, readable from across a big room. Recent calls and counts stay small at the bottom. */
function Single(p: LayoutProps) {
  return (
    <div className="grid min-h-0 flex-1 grid-rows-[1fr_auto] gap-[1.6vh] px-[3vw] pb-[2vh]">
      <NowServing {...p} size="xl" />
      <div className="grid grid-cols-[1fr_1fr] gap-[2vw]">
        <RecentCalls {...p} />
        <WaitingBoard {...p} />
      </div>
    </div>
  );
}

/** Multi-zone: latest call, desk list, rotating slides and waiting counts on one screen. */
function Multi(p: LayoutProps) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[1.1fr_1fr] grid-rows-[1fr_1fr] gap-[1.6vh_2vw] px-[3vw] pb-[2vh]">
      <NowServing {...p} />
      <Places {...p} />
      <Slides state={p.state} lang={p.lang} />
      <div className="grid min-h-0 content-start gap-[1.6vh] overflow-hidden">
        <RecentCalls {...p} />
        <WaitingBoard {...p} />
      </div>
    </div>
  );
}

export function ScreenLayout(p: LayoutProps) {
  const Body = p.state.display.layout === "single" ? Single : p.state.display.layout === "multi" ? Multi : Classic;
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <Header {...p} />
      <Body {...p} />
      <Ticker state={p.state} lang={p.lang} />
    </div>
  );
}
