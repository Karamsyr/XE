import {WEBGL_INFO} from "../../../../webglInfo.js";

/**
 * @private
 */
class BatchingOcclusionShaderSource {
    constructor(scene) {
        this.vertex = buildVertex(scene);
        this.fragment = buildFragment(scene);
    }
}

function buildVertex(scene) {
    const clipping = scene._sectionPlanesState.sectionPlanes.length > 0;
    const src = [];
    src.push("// Batched occlusion vertex shader");
    if (scene.logarithmicDepthBufferEnabled && WEBGL_INFO.SUPPORTED_EXTENSIONS["EXT_frag_depth"]) {
        src.push("#extension GL_EXT_frag_depth : enable");
    }
    src.push("attribute vec3 position;");
    if (scene.entityOffsetsEnabled) {
        src.push("attribute vec3 offset;");
    }
    src.push("attribute vec4 color;");
    src.push("attribute vec4 flags;");
    src.push("attribute vec4 flags2;");

    src.push("uniform mat4 worldMatrix;");
    src.push("uniform mat4 viewMatrix;");
    src.push("uniform mat4 projMatrix;");
    src.push("uniform mat4 positionsDecodeMatrix;")
    if (scene.logarithmicDepthBufferEnabled) {
        src.push("uniform float logDepthBufFC;");
        if (WEBGL_INFO.SUPPORTED_EXTENSIONS["EXT_frag_depth"]) {
            src.push("varying float vFragDepth;");
        }
    }
    if (clipping) {
        src.push("varying vec4 vWorldPosition;");
        src.push("varying vec4 vFlags2;");
    }
    src.push("void main(void) {");
    src.push("  bool visible   = (float(flags.x) > 0.0);");
    src.push("  bool culled   = (float(flags2.w) > 0.0);");
    src.push("  bool transparent  = ((float(color.a) / 255.0) < 1.0);");
    src.push("  if (culled || !visible || transparent) {");
    src.push("      gl_Position = vec4(0.0, 0.0, 0.0, 0.0);"); // Cull vertex
    src.push("  } else {");
    src.push("      vec4 worldPosition = worldMatrix * (positionsDecodeMatrix * vec4(position, 1.0)); ");
    if (scene.entityOffsetsEnabled) {
        src.push("      worldPosition.xyz = worldPosition.xyz + offset;");
    }
    ;
    src.push("      vec4 viewPosition  = viewMatrix * worldPosition; ");
    if (clipping) {
        src.push("      vWorldPosition = worldPosition;");
        src.push("      vFlags2 = flags2;");
    }
    src.push("vec4 clipPos = projMatrix * viewPosition;");
    if (scene.logarithmicDepthBufferEnabled) {
        if (WEBGL_INFO.SUPPORTED_EXTENSIONS["EXT_frag_depth"]) {
            src.push("vFragDepth = 1.0 + clipPos.w;");
        } else {
            src.push("clipPos.z = log2( max( 1e-6, clipPos.w + 1.0 ) ) * logDepthBufFC - 1.0;");
            src.push("clipPos.z *= clipPos.w;");
        }
    }
    src.push("gl_Position = clipPos;");
    src.push("  }");
    src.push("}");
    return src;
}

function buildFragment(scene) {
    const sectionPlanesState = scene._sectionPlanesState;
    const clipping = sectionPlanesState.sectionPlanes.length > 0;
    const src = [];
    src.push("// Batched occlusion fragment shader");
    if (scene.logarithmicDepthBufferEnabled && WEBGL_INFO.SUPPORTED_EXTENSIONS["EXT_frag_depth"]) {
        src.push("#extension GL_EXT_frag_depth : enable");
    }
    src.push("#ifdef GL_FRAGMENT_PRECISION_HIGH");
    src.push("precision highp float;");
    src.push("precision highp int;");
    src.push("#else");
    src.push("precision mediump float;");
    src.push("precision mediump int;");
    src.push("#endif");
    if (scene.logarithmicDepthBufferEnabled && WEBGL_INFO.SUPPORTED_EXTENSIONS["EXT_frag_depth"]) {
        src.push("uniform float logDepthBufFC;");
        src.push("varying float vFragDepth;");
    }
    if (clipping) {
        src.push("varying vec4 vWorldPosition;");
        src.push("varying vec4 vFlags2;");
        for (let i = 0; i < sectionPlanesState.sectionPlanes.length; i++) {
            src.push("uniform bool sectionPlaneActive" + i + ";");
            src.push("uniform vec3 sectionPlanePos" + i + ";");
            src.push("uniform vec3 sectionPlaneDir" + i + ";");
        }
    }
    src.push("void main(void) {");
    if (clipping) {
        src.push("  bool clippable = (float(vFlags2.x) > 0.0);");
        src.push("  if (clippable) {");
        src.push("      float dist = 0.0;");
        for (let i = 0; i < sectionPlanesState.sectionPlanes.length; i++) {
            src.push("      if (sectionPlaneActive" + i + ") {");
            src.push("          dist += clamp(dot(-sectionPlaneDir" + i + ".xyz, vWorldPosition.xyz - sectionPlanePos" + i + ".xyz), 0.0, 1000.0);");
            src.push("      }");
        }
        src.push("      if (dist > 0.0) { discard; }");
        src.push("  }");
    }
    if (scene.logarithmicDepthBufferEnabled && WEBGL_INFO.SUPPORTED_EXTENSIONS["EXT_frag_depth"]) {
        src.push("gl_FragDepthEXT = log2( vFragDepth ) * logDepthBufFC * 0.5;");
    }
    src.push("   gl_FragColor = vec4(0.0, 0.0, 1.0, 1.0); "); // Occluders are blue
    src.push("}");
    return src;
}

export {BatchingOcclusionShaderSource};