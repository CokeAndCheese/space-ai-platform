/**
 * 模型压缩脚本
 * 用法：npm run compress
 * 输入：public/models/hospital.glb
 * 输出：public/models/hospital.opt.glb（不会覆盖原文件）
 *
 * 压缩策略（保守，不动几何精度，只换更高效的格式）：
 *   - 纹理 → JPEG（浏览器原生支持，不依赖 GLTF 扩展声明）
 *   - 保留 Draco 几何压缩（GLB 自带）
 *   - 不做 simplify，保留 100% 顶点
 */
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, KHRDracoMeshCompression } from '@gltf-transform/extensions'
import { textureCompress, prune } from '@gltf-transform/functions'
import sharp from 'sharp'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const SRC = path.resolve('public/models/hospital.glb')
const DST = path.resolve('public/models/hospital.opt.glb')

async function main() {
  const t0 = Date.now()
  const beforeStat = await fs.stat(SRC)
  console.log(`\n输入: ${SRC}`)
  console.log(`大小: ${(beforeStat.size / 1024 / 1024).toFixed(2)} MB\n`)

  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'draco3d.encoder': await import('draco3d').then((m) => m.createEncoderModule()),
      'draco3d.decoder': await import('draco3d').then((m) => m.createDecoderModule())
    })

  const doc = await io.read(SRC)
  console.log('压缩纹理 → JPEG (q=80) ...')
  await doc.transform(
    textureCompress({
      encoder: sharp,
      targetFormat: 'jpeg',
      quality: 80
    })
  )

  // 清理不再需要的资源
  await doc.transform(prune())

  // 显式启用 Draco（GLB 通常已自带，再保险一次）
  const dracoExt = doc.getRoot().listExtensionsUsed().find((e) => e.extensionName === 'KHR_draco_mesh_compression')
  if (!dracoExt) {
    console.log('启用 Draco 几何压缩 ...')
    doc.createExtension(KHRDracoMeshCompression).setRequired(true)
  }

  const glb = await io.writeBinary(doc)
  await fs.writeFile(DST, glb)

  const afterStat = await fs.stat(DST)
  const ratio = ((1 - afterStat.size / beforeStat.size) * 100).toFixed(1)
  const dt = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`\n输出: ${DST}`)
  console.log(`大小: ${(afterStat.size / 1024 / 1024).toFixed(2)} MB`)
  console.log(`减少: ${ratio}% （耗时 ${dt}s）`)
  console.log('\n提示：刷新浏览器即可看到新模型。')
  console.log('     如果不满意，删除 hospital.opt.glb，把代码里的 MODEL_URL 指回 hospital.glb 即可。\n')
}

main().catch((err) => {
  console.error('压缩失败:', err)
  process.exit(1)
})