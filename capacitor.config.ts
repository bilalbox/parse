import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.twenty3p.parse',
  appName: 'parse',
  webDir: 'public',
  appendUserAgent: 'ParseAndroidApp',
  server: {
    url: 'https://parse.23p.dev',
    androidScheme: 'https'
  }
};

export default config;
