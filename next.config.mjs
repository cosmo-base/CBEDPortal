/** @type {import('next').NextConfig} */
const nextConfig = {
  // GitHub Pages（event.admin.fsif.jp）で配信するため静的エクスポート
  output: 'export',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
}

export default nextConfig
