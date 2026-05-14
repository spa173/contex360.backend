import { defineConfig } from 'vite';
import { VitePluginNode } from 'vite-plugin-node';

export default defineConfig({
  server: {
    port: 3001,
  },
  plugins: [
    ...VitePluginNode({
      adapter: 'nest',
      appPath: './src/main.ts',
      exportName: 'viteNodeApp',
      tsCompiler: 'swc',
    }),
  ],
  define: {
    'process.env.VITE': 'true',
  },
  ssr: {
    external: [
      'express',
      'reflect-metadata',
      '@nestjs/core',
      '@nestjs/common',
      '@nestjs/config',
      '@nestjs/swagger',
      '@nestjs/jwt',
      'class-transformer',
      'class-validator',
    ],
  },
  optimizeDeps: {
    // NestJS and other libraries may need to be excluded from optimization
    exclude: [
      '@nestjs/microservices',
      '@nestjs/websockets',
      'cache-manager',
      'class-transformer',
      'class-validator',
    ],
  },
});
