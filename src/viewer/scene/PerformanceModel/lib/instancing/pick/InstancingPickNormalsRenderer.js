import {Program} from "../../../../webgl/Program.js";
import {InstancingPickNormalsShaderSource} from "./InstancingPickNormalsShaderSource.js";
import {createRTCViewMat, getPlaneRTCPos} from "../../../../math/rtcCoords.js";
import {math} from "../../../../math/math.js";

const tempVec3a = math.vec3();

/**
 * @private
 */
class InstancingPickNormalsRenderer {

    constructor(scene) {
        this._scene = scene;
        this._hash = this._getHash();
        this._shaderSource = new InstancingPickNormalsShaderSource(this._scene);
        this._allocate();
    }

    getValid() {
        return this._hash === this._getHash();
    };

    _getHash() {
        return this._scene._sectionPlanesState.getHash();
    }

    drawLayer(frameCtx, instancingLayer) {

        const model = instancingLayer.model;
        const scene = model.scene;
        const camera = scene.camera;
        const gl = scene.canvas.gl;
        const state = instancingLayer._state;
        const instanceExt = this._instanceExt;
        const rtcCenter = instancingLayer._state.rtcCenter;

        if (!this._program) {
            this._allocate(instancingLayer);
            if (this.errors) {
                return;
            }
        }

        if (frameCtx.lastProgramId !== this._program.id) {
            frameCtx.lastProgramId = this._program.id;
            this._bindProgram();
        }

        // In practice, these binds will only happen once per frame
        // because we pick normals on a single previously-picked mesh

        gl.uniform1i(this._uPickInvisible, frameCtx.pickInvisible);

        const pickViewMatrix = frameCtx.pickViewMatrix || camera.viewMatrix;
        const rtcPickViewMatrix = (rtcCenter) ? createRTCViewMat(pickViewMatrix, rtcCenter) : pickViewMatrix;

        gl.uniformMatrix4fv(this._uViewMatrix, false, rtcPickViewMatrix);
        gl.uniformMatrix4fv(this._uProjMatrix, false, frameCtx.pickProjMatrix);

        gl.uniformMatrix4fv(this._uWorldMatrix, false, model.worldMatrix);
        gl.uniformMatrix4fv(this._uWorldNormalMatrix, false, model.worldNormalMatrix);

        if (scene.logarithmicDepthBufferEnabled) {
            const logDepthBufFC = 2.0 / (Math.log(camera.project.far + 1.0) / Math.LN2); // TODO: Far from pick project matrix?
            gl.uniform1f(this._uLogDepthBufFC, logDepthBufFC);
        }

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

        gl.uniformMatrix4fv(this._uPositionsDecodeMatrix, false, instancingLayer._state.positionsDecodeMatrix);

        this._aModelMatrixCol0.bindArrayBuffer(state.modelMatrixCol0Buf);
        this._aModelMatrixCol1.bindArrayBuffer(state.modelMatrixCol1Buf);
        this._aModelMatrixCol2.bindArrayBuffer(state.modelMatrixCol2Buf);

        instanceExt.vertexAttribDivisorANGLE(this._aModelMatrixCol0.location, 1);
        instanceExt.vertexAttribDivisorANGLE(this._aModelMatrixCol1.location, 1);
        instanceExt.vertexAttribDivisorANGLE(this._aModelMatrixCol2.location, 1);

        this._aModelNormalMatrixCol0.bindArrayBuffer(state.modelNormalMatrixCol0Buf);
        this._aModelNormalMatrixCol1.bindArrayBuffer(state.modelNormalMatrixCol1Buf);
        this._aModelNormalMatrixCol2.bindArrayBuffer(state.modelNormalMatrixCol2Buf);

        instanceExt.vertexAttribDivisorANGLE(this._aModelNormalMatrixCol0.location, 1);
        instanceExt.vertexAttribDivisorANGLE(this._aModelNormalMatrixCol1.location, 1);
        instanceExt.vertexAttribDivisorANGLE(this._aModelNormalMatrixCol2.location, 1);

        this._aPosition.bindArrayBuffer(state.positionsBuf);
        this._aNormal.bindArrayBuffer(state.normalsBuf);
        this._aFlags.bindArrayBuffer(state.flagsBuf);
        instanceExt.vertexAttribDivisorANGLE(this._aFlags.location, 1);

        if (this._aFlags2) {
            this._aFlags2.bindArrayBuffer(state.flags2Buf);
            instanceExt.vertexAttribDivisorANGLE(this._aFlags2.location, 1);
        }

        if (this._aOffset) {
            this._aOffset.bindArrayBuffer(state.offsetsBuf);
            instanceExt.vertexAttribDivisorANGLE(this._aOffset.location, 1);
        }

        state.indicesBuf.bind();

        instanceExt.drawElementsInstancedANGLE(state.primitive, state.indicesBuf.numItems, state.indicesBuf.itemType, 0, state.numInstances);

        instanceExt.vertexAttribDivisorANGLE(this._aModelMatrixCol0.location, 0);
        instanceExt.vertexAttribDivisorANGLE(this._aModelMatrixCol1.location, 0);
        instanceExt.vertexAttribDivisorANGLE(this._aModelMatrixCol2.location, 0);
        instanceExt.vertexAttribDivisorANGLE(this._aModelNormalMatrixCol0.location, 0);
        instanceExt.vertexAttribDivisorANGLE(this._aModelNormalMatrixCol1.location, 0);
        instanceExt.vertexAttribDivisorANGLE(this._aModelNormalMatrixCol2.location, 0);
        instanceExt.vertexAttribDivisorANGLE(this._aFlags.location, 0);

        if (this._aFlags2) { // Won't be in shader when not clipping
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
        this._uPickInvisible = program.getLocation("pickInvisible");
        this._uPositionsDecodeMatrix = program.getLocation("positionsDecodeMatrix");
        this._uWorldMatrix = program.getLocation("worldMatrix");
        this._uWorldNormalMatrix = program.getLocation("worldNormalMatrix");
        this._uViewMatrix = program.getLocation("viewMatrix");
        this._uViewNormalMatrix = program.getLocation("viewNormalMatrix");
        this._uProjMatrix = program.getLocation("projMatrix");

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
        this._aNormal = program.getAttribute("normal");
        this._aFlags = program.getAttribute("flags");
        this._aFlags2 = program.getAttribute("flags2");

        this._aModelMatrixCol0 = program.getAttribute("modelMatrixCol0");
        this._aModelMatrixCol1 = program.getAttribute("modelMatrixCol1");
        this._aModelMatrixCol2 = program.getAttribute("modelMatrixCol2");

        this._aModelNormalMatrixCol0 = program.getAttribute("modelNormalMatrixCol0");
        this._aModelNormalMatrixCol1 = program.getAttribute("modelNormalMatrixCol1");
        this._aModelNormalMatrixCol2 = program.getAttribute("modelNormalMatrixCol2");

        if (scene.logarithmicDepthBufferEnabled) {
            this._uLogDepthBufFC = program.getLocation("logDepthBufFC");
        }
    }

    _bindProgram() {
        this._program.bind();
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

export {InstancingPickNormalsRenderer};