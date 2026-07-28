"use client";

import dynamic from "next/dynamic";

const ChaengyeosumApp = dynamic(() => import("../../../src/App"), {
  ssr: false,
  loading: () => (
    <main className="sites-loading">챙겨썸을 준비하고 있어요…</main>
  ),
});

export default function ChaengyeosumPage() {
  return <ChaengyeosumApp />;
}
