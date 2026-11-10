import * as THREE from 'three';

export const FOREST_GRASS_MORPH = Object.freeze({ start: 6, end: 12 });

/** Keep all four photographed cards and every plant. At a distance, straighten
 * the middle row continuously, then stop submitting its redundant triangles.
 * Both representations share the same immutable instance and vertex buffers. */
export function forestGrassGeometries(near: THREE.BufferGeometry, cards: 2 | 4 = 4) {
  const position = near.getAttribute('position'), normal = near.getAttribute('normal');
  const color = near.getAttribute('color');
  if (position.count !== 24) throw new Error('Expected four six-vertex forest grass cards');
  // Adjacent source cards cross at ninety degrees. Keep their original curved
  // silhouettes and photographic UVs, omitting the redundant opposite pair.
  if (cards === 2 && near.index) near.setIndex(Array.from(near.index.array).slice(0, 24));
  for (const [name, source] of [['Position', position], ['Normal', normal], ['Color', color]] as const) {
    const values = new Float32Array(source.count * 3);
    for (let i = 0; i < source.count; i++) {
      const row = i % 6;
      for (let axis = 0; axis < 3; axis++) values[i * 3 + axis] = row === 2 || row === 3
        ? (source.getComponent(i - 2, axis) + source.getComponent(i + 2, axis)) * .5
        : source.getComponent(i, axis);
    }
    near.setAttribute(`forestFar${name}`, new THREE.BufferAttribute(values, 3));
  }
  const far = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(near.attributes)) far.setAttribute(name, attribute);
  const indices: number[] = [];
  for (let card = 0; card < cards; card++) {
    const i = card * 6;
    indices.push(i, i + 1, i + 4, i + 1, i + 5, i + 4);
  }
  far.setIndex(indices);
  far.boundingBox = near.boundingBox!.clone();
  far.boundingSphere = near.boundingSphere?.clone() ?? null;
  return { near, far };
}

export function applyForestGrassMorph(material: THREE.Material, viewer: THREE.IUniform<THREE.Vector3>) {
  const previous = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.uForestGrassViewer = viewer;
    shader.vertexShader = `uniform vec3 uForestGrassViewer;
      attribute vec3 forestFarPosition, forestFarNormal, forestFarColor;
      ` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('void main() {', `void main() {
      float forestGrassMorph = smoothstep(${FOREST_GRASS_MORPH.start.toFixed(1)}, ${FOREST_GRASS_MORPH.end.toFixed(1)},
        distance(instanceMatrix[3].xz, uForestGrassViewer.xz));`);
    shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>',
      '#include <beginnormal_vertex>\nobjectNormal = mix(normal, forestFarNormal, forestGrassMorph);');
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\ntransformed = mix(position, forestFarPosition, forestGrassMorph);');
    shader.vertexShader = shader.vertexShader.replace('#include <color_vertex>',
      THREE.ShaderChunk.color_vertex.replace('vColor.rgb *= color;', 'vColor.rgb *= mix(color, forestFarColor, forestGrassMorph);'));
  };
  material.customProgramCacheKey = () => `${key}|forest-four-card-continuous-morph-v1`;
}
