# 高清公开 CT 影像

原始文件保存在本目录；网站发布连续切片的无损压缩分块，保持原始矩阵、数值、间距、方向和来源层号，不插值放大。

| 网站序列 | 原始来源 | 许可 | 发布层（从 1 计数） |
| --- | --- | --- | --- |
| 脑部 CT | 3D Slicer CT-MR Brain / CTBrain | Slicer 官方明确说明受试者捐赠，允许不受限制使用 | 27–58 / 76 |
| 腹部与肝脏 CT | Medical Segmentation Decathlon Task03 Liver，liver_100，由 Slicer 提供 NRRD | CC BY-SA 4.0 | 481–528 / 685 |
| 肝血管增强 CT | Medical Segmentation Decathlon Task08 HepaticVessel，imagesTs/hepaticvessel_306.nii.gz | CC BY-SA 4.0 | 1–28 / 28 |

Slicer 来源及授权说明：https://github.com/Slicer/Slicer/blob/main/Modules/Scripted/SampleData/SampleData.py

MSD Task08 的 dataset.json 已原样保存为 vessel-dataset.json，包含 CC-BY-SA 4.0 许可字段。CC BY-SA 4.0：https://creativecommons.org/licenses/by-sa/4.0/ 。对这两个 MSD 序列的选片和重打包继续使用相同许可。

Slicer 官方明确禁止再分发的 CTA abdomen / Panoramix 未使用。肝血管使用上述 MSD 影像。

全部三组为原始 CT 数值（HU），没有发布参考分割；真实影像 ROI 显示面积、灰度和熵，不显示 Dice。保留单独的数学合成实验，提供已知目标真值和 Dice。

下载脚本：_tools/download_imaging_v22.mjs；处理脚本：_tools/prepare_imaging_v22.py；处理参数和精确来源见 provenance.json。
