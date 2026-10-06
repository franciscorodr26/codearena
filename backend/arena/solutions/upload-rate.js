function minUploadRate(sizes, hours) {
  let lo = 1, hi = Math.max(...sizes)
  const fits = r => { let h = 0; for (const s of sizes) h += Math.ceil(s / r); return h <= hours }
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (fits(mid)) hi = mid; else lo = mid + 1
  }
  return lo
}
