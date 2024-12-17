import { viteStaticCopy } from 'vite-plugin-static-copy'
// import { createHtmlPlugin } from 'vite-plugin-html'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { normalizePath } from 'vite'
import path from 'node:path'

export default defineConfig({
  server:{
    port:909
  },
  plugins: [

    react(),
    
    // createHtmlPlugin({
    //   entry: 'src/index.tsx',
    //   template: './src/index.html',
    //   inject: {
    //     data: {
    //       title: 'index',
    //       injectScript: `<script src="./inject.js"></script>`,
    //     },
    // }),
    
    viteStaticCopy({
        targets: [
          {
            src: 'assets/**/*',
            dest: 'assets'
          }
        ]
    })


]})