import {Program} from "../../../../webgl/Program.js";
import {InstancingFillShaderSource} from "./InstancingFillShaderSource.js";
import {RENDER_PASSES} from "../../renderPasses.js";
import {createRTCViewMat, getPlaneRTCPos} from "../../../../math/rtcCoords.js";
import {math} from "../../../../math/math.js";

const tempVec3a = math.vec3();

/**
 * @private
 */
class InstancingFillRenderer {

    constructor(scene) {
        this._scene = scene;
        this._hash = this._getHash();
        this._shaderSource = new InstancingFillShaderSource(this._scene);
        this._allocate();
    }

    getValid() {
        return this._hash === this._getHash();
    };

    _getHash() {
        return this._scene._sectionPlanesState.getHash();
    }

    drawLayer(frameCtx, instancingLayer, renderPass) {

        const model = instancingLayer.model;
        const scene = model.scene;
        const camera = scene.camera;
        const gl = scene.canvas.gl;
        const state = instancingLayer._state;
        const instanceExt = this._instanceExt;
        const rtcCenter = instancingLayer._state.rtcCenter;

        if (!this._program) {
            this._allocate(instancingLayer.model.scene);
            if (this.errors) {
                return;
            }
        }

        if (frameCtx.lastProgramId !== this._program.id) {
            frameCtx.lastProgramId = this._program.id;
            this._bindProgram();
        }

        gl.uniformMatrix4fv(this._uViewMatrix, false, (rtcCenter) ? createRTCViewMat(camera.viewMatrix, rtcCenter) : camera.viewMatrix);
        gl.uniformMatrix4fv(this._uWorldMatrix, false, model.worldMatrix);

        const numSectionPlanes = scene._sectionPlanesState.sectionPlanes.length;
        if (numSectionPlanes > 0) {
            const sectionPlanes = scene._sectionPlanesState.sectionPlanes;
            const baseIndex = instancingLayer.layerIndex * numSectionPlanes;
            const renderFlags = model.renderFlags;
            for (let sectionPlaneIndex = 0; sectionPlaneIndex < numSectionPlanes; sectionPlaneIndex++) {
                const sectionPlaneUniforms = this._uSectionPlanes[sectionPlaneIndex];
                const active = renderFlags.sectionPlanesActivePerLayer[baseIndex + sectionPlaneIndex];
                gl.uniform1i(sectionPlaneUniforms.active, active ? 1 : 0);
                if (active) {
                    const sectionPlane = sectionPlanes[sectionPlaneIndex];
                    if (rtcCenter) {
                        const rtcSectionPlanePos = getPlaneRTCPos(sectionPlane.dist, sectionPlane.dir, rtcCenter, tempVec3a);
                        gl.uniform3fv(sectionPlaneUniforms.pos, rtcSectionPlanePos);
                    } else {
                        gl.uniform3fv(sectionPlaneUniforms.pos, sectionPlane.pos);
                    }
                    gl.uniform3fv(sectionPlaneUniforms.dir, sectionPlane.dir);
                }
            }
        }

        gl.uniform1i(this._uRenderPass, renderPass);
        gl.uniformMatrix4fv(this._uPositionsDecodeMatrix, false, instancingLayer._state.positionsDecodeMatrix);

        this._aModelMatrixCol0.bindArrayBuffer(state.modelMatrixCol0Buf);
        this._aModelMatrixCol1.bindArrayBuffer(state.modelMatrixCol1Buf);
        this._aModelMatrixCol2.bindArrayBuffer(state.modelMatrixCol2Buf);

        instanceExt.vertexAttribDivisorANGLE(this._aModelMatrixCol0.location, 1);
        instanceExt.vertexAttribDivisorANGLE(this._aModelMatrixCol1.location, 1);
        instanceExt.vertexAttribDivisorANGLE(this._aModelMatrixCol2.location, 1);

        this._aPosition.bindArrayBuffer(state.positionsBuf);

        this._aFlags.bindArrayBuffer(state.flagsBuf, gl.UNSIGNED_BYTE, true);
        instanceExt.vertexAttribDivisorANGLE(this._aFlags.location, 1);

        if (this._aFlags2) {
            this._aFlags2.bindArrayBuffer(state.flags2Buf, gl.UNSIGNED_BYTE, true);
            instanceExt.vertexAttribDivisorANGLE(this._aFlags2.location, 1);
        }

        if (this._aOffset) {
            this._aOffset.bindArrayBuffer(state.offsetsBuf);
            instanceExt.vertexAttribDivisorANGLE(this._aOffset.location, 1);
        }

        state.indicesBuf.bind();

        if (renderPass === RENDER_PASSES.XRAYED) {
            const material = scene.xrayMaterial._state;
            const fillColor = material.fillColor;
            const fillAlpha = material.fillAlpha;
            gl.uniform4f(this._uColor, fillColor[0], fillColor[1], fillColor[2], fillAlpha);

        } else if (renderPass === RENDER_PASSES.HIGHLIGHTED) {
            const material = scene.highlightMaterial._state;
            const fillColor = material.fillColor;
            const fillAlpha = material.fillAlpha;
            gl.uniform4f(this._uColor, fillColor[0], fillColor[1], fillColor[2], fillAlpha);

        } else if (renderPass === RENDER_PASSES.SELECTED) {
            const material = scene.selectedMaterial._state;
            const fillColor = material.fillColor;
            const fillAlpha = material.fillAlpha;
            gl.uniform4f(this._uColor, fillColor[0], fillColor[1], fillColor[2], fillAlpha);

        } else {
            gl.uniform4fv(this._uColor, math.vec3([1, 1, 1]));
        }

        instanceExt.drawElementsInstancedANGLE(state.primitive, state.indicesBuf.numItems, state.indicesBuf.itemType, 0, state.numInstances);

        instanceExt.vertexAttribDivisorANGLE(this._aModelMatrixCol0.location, 0); // TODO: Is this needed
        instanceExt.vertexAttribDivisorANGLE(this._aModelMatrixCol1.location, 0);
        instanceExt.vertexAttribDivisorANGLE(this._aModelMatrixCol2.location, 0);

        instanceExt.vertexAttribDivisorANGLE(this._aFlags.location, 0);
        if (this._aFlags2) {
            instanceExt.vertexAttribDivisorANGLE(this._aFlags2.location, 0);
        }
        if (this._aOffset) {
            instanceExt.vertexAttribDivisorANGLE(this._aOffset.location, 0);
        }
    }

    _allocate() {

        const scene = this._scene;
        const gl = scene.canvas.gl;
        const sectionPlanesState = scene._sectionPlanesState;

        this._program = new Program(gl, this._shaderSource);

        if (this._program.errors) {
            this.errors = this._program.errors;
            return;
        }

        this._instanceExt = gl.getExtension("ANGLE_instanced_arrays");

        const program = this._program;

        this._uRenderPass = program.getLocation("renderPass");
        this._uPositionsDecodeMatrix = program.getLocation("positionsDecodeMatrix");
        this._uWorldMatrix = program.getLocation("worldMatrix");
        this._uViewMatrix = program.getLocation("viewMatrix");
        this._uProjMatrix = program.getLocation("projMatrix");
        this._uColor = program.getLocation("color");
        this._uSectionPlanes = [];

        const clips = sectionPlanesState.sectionPlanes;
        for (let i = 0, len = clips.length; i < len; i++) {
            this._uSectionPlanes.push({
                active: program.getLocation("sectionPlaneActive" + i),
                pos: program.getLocation("sectionPlanePos" + i),
                dir: program.getLocation("sectionPlaneDir" + i)
            });
        }

        this._aPosition = program.getAttribute("position");
        this._aOffset = program.getAttribute("offset");
        this._aFlags = program.getAttribute("flags");
        this._aFlags2 = program.getAttribute("flags2");
        this._aModelMatrixCol0 = program.getAttribute("modelMatrixCol0");
        this._aModelMatrixCol1 = program.getAttribute("modelMatrixCol1");
        this._aModelMatrixCol2 = program.getAttribute("modelMatrixCol2");

        if ( scene.logarithmicDepthBufferEnabled) {
            this._uLogDepthBufFC = program.getLocation("logDepthBufFC");
        }
    }

    _bindProgram() {

        const scene = this._scene;
        const gl = scene.canvas.gl;
        const project = scene.camera.project;

        this._program.bind();

        gl.uniformMatrix4fv(this._uProjMatrix, false, project.matrix);

        if ( scene.logarithmicDepthBufferEnabled) {
            const logDepthBufFC = 2.0 / (Math.log(project.far + 1.0) / Math.LN2);
            gl.uniform1f(this._uLogDepthBufFC, logDepthBufFC);
        }
    }

    webglContextRestored() {
        this._program = null;
    }

    destroy() {
        if (this._program) {
            this._program.destroy();
        }
        this._program = null;
    }
}

export {InstancingFillRenderer};