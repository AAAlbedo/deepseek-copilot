import ChatLayout from '@/components/ChatLayout';
import { Metadata, Viewport } from 'next';

export const viewport: Viewport = {
  themeColor: '#000000',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const metadata: Metadata = {
  title: 'DeepSeek Copilot',
  description: 'A mobile-first AI assistant powered by DeepSeek.',
  manifest: '/manifest.json',
};

export default function Home() {
  return (
    <main>
      <ChatLayout />
    </main>
  );
}
