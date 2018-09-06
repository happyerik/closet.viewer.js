import * as Global from '@/lib/clo/utils/Global'
import * as THREE from '@/lib/threejs/three'
import JSZip from '@/lib/jszip/dist/jszip'
import { readHeader } from '@/lib/clo/file/FileHeader'
import { readByteArray, readMap } from '@/lib/clo/file/KeyValueMapReader'
import { envDiffuseMap, envSpecularMap } from '@/lib/clo/file/EnvMapReader'

import fragmentShader from 'raw-loader!@/lib/clo/shader/fragmentShader.frag'
import pbrFragmentShader from 'raw-loader!@/lib/clo/shader/pbrFragmentShader.frag'
import vertexShader from 'raw-loader!@/lib/clo/shader/vertexShader.vert'
import pbrVertexShader from 'raw-loader!@/lib/clo/shader/pbrVertexShader.vert'

let camera;
let controls;
let _globalZip;
var _globalWorkerCount = 0;
var _globalWorkerCreateFlag = false;
var _globalCompleteLoadFile = false;
var _gNameToTextureMap = new Map();
var gSeamPuckeringNormalMap = null;
var FileReaderSyncSupport = false;
var syncDetectionScript = "onmessage = function(e) { postMessage(!!FileReaderSync); };";
var drawMode = { wireframe: { pattern: false, button: false } };

// !!!! CLO에 있는 TextureType 그대로 가져왔으므로 CLO 변경되면 여기서도 변경해 줘야 함
var TextureType =
    {
        GLOBAL_MAP: 0,
        DIFFUSE_MAP: 1,
        AMBIENT_MAP: 2,
        SPECULAR_MAP: 3,
        NORMAL_MAP: 4,
        DISPLACEMENT_MAP: 5,
        TRANSPARENTT_MAP: 6, // TRANSPARENT 가 win뭐시기에서 이미 정의되어서 이렇게 씀
        DIFFUSE_OVERLAY_MAP: 7,
        SPECULAR_OVERLAY_MAP: 8,
        REFLECTIVE_MAP: 9,
        EMISSION_MAP: 10,
        GLOSSINESS_MAP: 11, // PBR glossiness map,
        METALNESS_MAP: 12
        //MAX_TEXTURE_TYPE // 항상 마지막에 위치시키기
    };

var RenderFace =
    {
        MV_DOUBLE_FACE: 0,
        MV_FRONT_FACE: 1,
        MV_BACK_FACE: 2
    };

export default function ZRestLoader({ scene, camera, controls, cameraPosition }, manager) {
    this.scene = scene
    this.camera = camera
    this.controls = controls
    this.cameraPosition = cameraPosition
    this.manager = (manager !== undefined) ? manager : THREE.DefaultLoadingManager;

    this.matMeshList = []
    this.materialInformationMap = null
    this.currentColorwayIndex = 0
    this.colorwaySize = 0
    this.jsZip = null
};

ZRestLoader.prototype = {

    constructor: ZRestLoader,

    load(url, onLoad, onProgress, onError) {

        this.onLoad = onLoad

        var loader = new THREE.FileLoader(this.manager);
        //loader.setPath(this.path);
        loader.setResponseType('arraybuffer');
        loader.load(url, (data) => {

            this.parse(data)

        }, onProgress, onError);

    },

    setPath(value) {

        this.path = value;

    },

    parse(data) {

        var headerOffset = { Offset: 0 };
        var blob = new Blob([data]);
        var dataView = new DataView(data);
        var header = readHeader(dataView, headerOffset);
        
        return this.readZrestFromBlobForWeb(blob, header, this.scene);
    },

    readZrestFromBlobForWeb(blob, header, scene) {

        var object3D = new THREE.Object3D();
        object3D.name = 'object3D'

        var reader = new FileReader();

        var contentBlob = blob.slice(header.FileContentPos, header.FileContentPos + header.FileContentSize);

        var rootMap;
        var restName = "";
        var btnNameList = [];
        var bthNameList = [];

        reader.onload = (e) => {
            this.jsZip = new JSZip(e.target.result);
            var keyList = Object.keys(this.jsZip.files);

            keyList.forEach(value => {
                var list = value.split('.');
                var extension = list[list.length - 1];

                switch (extension) {
                    case 'rest':
                        restName = value;
                        break;
                    case 'btn':
                        btnNameList.push(value);
                        break;
                    case 'bth':
                        bthNameList.push(value);
                        break;
                    case 'png':
                    case 'jpg':

                        break;
                    case 'pos':

                        break;
                    default:
                };
            });

            var fileOffset = { Offset: 0 };
            var dataView = new DataView(this.jsZip.file(restName).asArrayBuffer());
            console.log("pac file size = " + dataView.byteLength);

            rootMap = readMap(dataView, fileOffset);

            // seam puckering normal map 로드
            gSeamPuckeringNormalMap = this.LoadTexture(this.jsZip, "seam_puckering_2ol97pf293f2sdk98.png");

            let loadedCamera =
                {
                    ltow : new THREE.Matrix4(),
                    bLoaded : false
                }
            this.meshFactory(rootMap, this.jsZip, object3D, loadedCamera);

            // 여기가 실질적으로 Zrest 로드 완료되는 시점
            // scene.add(object3D);
            this.onLoad(object3D)
            this.ZoomToObjects(loadedCamera, scene);
            // add 할때 cameraPosition 이 있으면 설정해준다.
            if(this.cameraPosition) this.camera.position.copy(this.cameraPosition)

            // 임시 데이터 clear
            _gNameToTextureMap.clear();


        }

        reader.readAsArrayBuffer(contentBlob);
    },

    ZoomToObjects(loadedCamera, scene) {
        // scene 의 모든 geometry 방문하면서 bounding cube 계산해서 전체 scene bounding cube 계산
        let box = new THREE.Box3();
        box.expandByObject(scene);
        var center = new THREE.Vector3(0.5 * (box.min.x + box.max.x), 0.5 * (box.min.y + box.max.y), 0.5 * (box.min.z + box.max.z));

        if(loadedCamera.bLoaded === true)
        {
            this.camera.position.copy(new THREE.Vector3(loadedCamera.ltow.elements[12], loadedCamera.ltow.elements[13], loadedCamera.ltow.elements[14]))

            let xAxis = new THREE.Vector3();
            let yAxis = new THREE.Vector3();
            let zAxis = new THREE.Vector3();
            loadedCamera.ltow.extractBasis(xAxis, yAxis, zAxis);

            zAxis.negate();

            center.sub(this.camera.position);
            let dotProd = center.dot(zAxis);
            zAxis.multiplyScalar(dotProd);
            zAxis.add(this.camera.position);
            this.controls.target.copy(zAxis);
        }
        else
        {
            // trim이나 이상한 점 하나가 너무 동떨어진 경우에는 정해진 center 바라보게 하자
            let maxDistance = 10000.0;
            if (box.min.x < -maxDistance || box.min.y < -1000.0 || box.min.z < -maxDistance || box.max.x > maxDistance || box.max.y > maxDistance || box.max.z > maxDistance) {
                center.x = 0.0;
                center.y = 1100.0;
                center.z = 0.0;
                this.controls.target.copy(center);
                center.z = 8000.0;
                this.camera.position.copy(center);

            }
            else {
                // 전체 scene bounding cube 의 중심을 바라보고 cube 를 fit하도록 camera zoom 설정
                this.camera.position.copy(center);
                this.camera.position.z = box.max.z + 0.5 * (box.max.y - box.min.y + 100.0) / Math.tan((this.camera.fov / 2) * Math.PI / 180.0); // 위아래로 100 mm 정도 여유있게
                this.controls.target.copy(center);
            }
        }


    },

    LoadTexture(zip, textureFileName) {
        let file = zip.file(textureFileName);
        if (file === undefined || file === null)
            return null;

        var arraybuffer = file.asArrayBuffer();
        var bytes = new Uint8Array(arraybuffer);
        var blob = new Blob([bytes.buffer]);
        var url = URL.createObjectURL(blob);

        var loader = new THREE.TextureLoader();
        return loader.load(url);
    },

    meshFactory(map, zip, retObject, loadedCamera) {

        let version = map.get("uiVersion");

        if (version === undefined)
            version = 1;

        this.gVersion = version;

        let mapCameraLtoW = map.get("m4CameraLocalToWorldMatrix");
        if(mapCameraLtoW !== undefined)
        {
            loadedCamera.bLoaded = true;
            loadedCamera.ltow.set(mapCameraLtoW.a00, mapCameraLtoW.a01, mapCameraLtoW.a02, mapCameraLtoW.a03,
                mapCameraLtoW.a10, mapCameraLtoW.a11, mapCameraLtoW.a12, mapCameraLtoW.a13,
                mapCameraLtoW.a20, mapCameraLtoW.a21, mapCameraLtoW.a22, mapCameraLtoW.a23,
                mapCameraLtoW.a30, mapCameraLtoW.a31, mapCameraLtoW.a32, mapCameraLtoW.a33);
        }

        var colorways = map.get("mapColorWay");
        if (colorways === undefined) {

        }
        else {
            this.currentColorwayIndex = colorways.get("uiCurrentCoordinationIndex");
            this.colorwaySize = colorways.get("listColorway").length;
        }

        var zRestMatMeshArray = map.get("listMaterials"); // 옛날 버전 이름
        if (zRestMatMeshArray === undefined)
            zRestMatMeshArray = map.get("listMatMesh"); // 최신 버전에서 사용한 명확한 이름

        this.materialInformationMap = new Map();

        if (zRestMatMeshArray === undefined) {

        }
        else {
            for (var i = 0 ; i < zRestMatMeshArray.length ; ++i) {
                var zRestColorwayMaterials = {
                    bpattern: false, // 이제 사용하지 않는다. 기존 버전 호환을 위해 사용할 뿐
                    bPolygonOffset: false,
                    colorwayMaterials: [],
                    colorwayObjectTextureTransformation: [],
                };

                var id = zRestMatMeshArray[i].get("uiMatMeshID");
                zRestColorwayMaterials.bpattern = zRestMatMeshArray[i].get("bPattern"); // 이제 사용하지 않는다. 기존 버전 호환을 위해 사용할 뿐
                zRestColorwayMaterials.bPolygonOffset = zRestMatMeshArray[i].get("bPolygonOffset");
                if (zRestColorwayMaterials.bPolygonOffset === undefined)
                    zRestColorwayMaterials.bPolygonOffset = (zRestColorwayMaterials.bpattern === 0); // 이전 버전에서는 이렇게 설정해 주고 있었다.. bPattern은 이제 사용하지 않는다.

                var listTexInfo = zRestMatMeshArray[i].get("listTexInfo");
                if (listTexInfo !== undefined) {
                    for (var j = 0 ; j < listTexInfo.length ; ++j) {
                        var info = {
                            angle: 0.0,
                            //scale: null,
                            translate: { x: 0.0, y: 0.0 }
                        };

                        info.angle = listTexInfo[j].get("fAngle");
                        info.translate = listTexInfo[j].get("v2Trans");

                        zRestColorwayMaterials.colorwayObjectTextureTransformation.push(info);
                    }
                }

                var listMaterial = zRestMatMeshArray[i].get("listMaterial");
                if (listMaterial !== undefined) {
                    for (var j = 0 ; j < listMaterial.length ; ++j) {
                        var material = {
                            ambient: null,
                            diffuse: null,
                            specular: null,
                            emission: null,
                            shininess: 0.0,
                            alpha: 0.0,

                            base: null,
                            reflectionColor: null,
                            blendFuncSrc: 0,
                            blendFuncDst: 0,
                            blendColor: 0,

                            opaqueMode: 0,
                            ambientIntensity: 0.0,
                            diffuseIntensity: 0.0,
                            normalMapIntensityInPercentage: 10.0,
                            zero: 0.0,
                            bPerfectTransparent: false,
                            bTransparent: false,
                            renderFace: RenderFace.MV_FRONT_FACE, // 기본값은 두께보기의상이 기본이므로 front로 하자. double 이 아닌 front로 하면 아바타 헤어 투명도가 CLO와 다르게 나오는 문제가 생기긴 하지만

                            // PBR 쪽 변수
                            materialType: 0,
                            bUseMetalnessRoughnessPBR: true,
                            glossiness: 0.0,
                            metalness: 0.0,
                            environmentLightIntensity: 0.0,
                            cameraLightIntensity: 0.0,
                            roughnessUIType: 0,
                            reflectionIntensity: 0.0,
                            frontColorMult: 1.0,
                            sideColorMult: 1.0,

                            texture: []
                        };

                        material.renderFace = listMaterial[j].get("enRenderFace");
                        material.bTransparent = listMaterial[j].get("bTransparent");
                        material.bPerfectTransparent = listMaterial[j].get("bPerfectTransparent");

                        material.ambient = new THREE.Vector3(listMaterial[j].get("v4Ambient").x, listMaterial[j].get("v4Ambient").y, listMaterial[j].get("v4Ambient").z);
                        material.diffuse = new THREE.Vector3(listMaterial[j].get("v4Diffuse").x, listMaterial[j].get("v4Diffuse").y, listMaterial[j].get("v4Diffuse").z);
                        material.specular = new THREE.Vector3(listMaterial[j].get("v4Specular").x, listMaterial[j].get("v4Specular").y, listMaterial[j].get("v4Specular").z);
                        material.emission = new THREE.Vector3(listMaterial[j].get("v4Emission").x, listMaterial[j].get("v4Emission").y, listMaterial[j].get("v4Emission").z);
                        material.shininess = listMaterial[j].get("fShininess");
                        material.alpha = listMaterial[j].get("v4Diffuse").w;

                        let normalIntensity = listMaterial[j].get("iNormalIntensity");
                        if (normalIntensity !== undefined && normalIntensity !== null)
                            material.normalMapIntensityInPercentage = normalIntensity * 10.0; // 기존에 최대 10인 intensity여서 10만 곱해서 최대 100% 로 맞춘다.
                        else
                            material.normalMapIntensityInPercentage = listMaterial[j].get("iNormalIntensityInPercentage");

                        material.base = new THREE.Vector3(listMaterial[j].get("v3BaseColor").x, listMaterial[j].get("v3BaseColor").y, listMaterial[j].get("v3BaseColor").z);

                        let reflectionColor = listMaterial[j].get("v3ReflectionColor");
                        if (reflectionColor !== undefined && reflectionColor !== null)
                            material.reflectionColor = new THREE.Vector3(listMaterial[j].get("v3ReflectionColor").x, listMaterial[j].get("v3ReflectionColor").y, listMaterial[j].get("v3ReflectionColor").z);
                        else
                            material.reflectionColor = new THREE.Vector3(59.0, 59.0, 59.0); // 실제로는 사용되지 않는 값이지만 초기화하자

                        material.blendFuncSrc = listMaterial[j].get("uiBlendFuncSrc");
                        material.blendFuncDst = listMaterial[j].get("uiBlendFuncDst");
                        material.blendColor = new THREE.Vector3(listMaterial[j].get("v4BlendColor").x, listMaterial[j].get("v4BlendColor").y, listMaterial[j].get("v4BlendColor").z);

                        material.opaqueMode = listMaterial[j].get("enOpaqueMode");
                        material.ambientIntensity = listMaterial[j].get("fAmbientIntensity");
                        material.diffuseIntensity = listMaterial[j].get("fDiffuseIntensity");
                        material.zero = listMaterial[j].get("fZero");

                        // pbr
                        material.materialType = listMaterial[j].get("iMaterialType");
                        if (material.materialType === undefined)
                            material.materialType = 0;

                        let bUseMetalnessRoughnessPBR = listMaterial[j].get("m_bUseMetalnessRoughnessPBR");
                        if (bUseMetalnessRoughnessPBR !== undefined)
                            material.bUseMetalnessRoughnessPBR = bUseMetalnessRoughnessPBR;
                        else
                            material.bUseMetalnessRoughnessPBR = true;

                        material.glossiness = listMaterial[j].get("fGlossiness");
                        material.metalness = listMaterial[j].get("fMetalness");
                        let bMetal = listMaterial[j].get("bMetal");
                        if (bMetal !== undefined && bMetal == false) // metalness 는 m_bMetal 에 의해 지배되고 있음. bMetal은 없어졌지만 기존 버전 호환을 위해 필요함.
                            material.metalness = 0.0;

                        material.environmentLightIntensity = listMaterial[j].get("fEnvironmentLightIntensity");
                        material.cameraLightIntensity = listMaterial[j].get("fCameraLightIntensity");

                        if (material.materialType == 6) // velvet
                        {
                            material.environmentLightIntensity = 0.0;
                            material.cameraLightIntensity = 0.7;
                        }

                        material.frontColorMult = listMaterial[j].get("fFrontColorMult");
                        if (material.frontColorMult === undefined)
                            material.frontColorMult = 1.0;

                        material.sideColorMult = listMaterial[j].get("fSideColorMult");
                        if (material.sideColorMult === undefined)
                            material.sideColorMult = 1.0;

                        material.roughnessUIType = listMaterial[j].get("iRoughnessUIType");
                        material.reflectionIntensity = listMaterial[j].get("fReflectionIntensity");

                        var tex = listMaterial[j].get("listTexture");
                        if (tex !== undefined && tex !== null) {
                            for (var k = 0 ; k < tex.length ; ++k) {
                                var textureProperty = {
                                    file: '',
                                    aifile: '',
                                    uniqfile: '',
                                    type: 0,

                                    angle: 0.0,
                                    translate: { x: 0.0, y: 0.0 },
                                    scale: { x: 0.0, y: 0.0 },
                                    colorInverted: false,
                                    intensity: 1.0
                                };

                                textureProperty.file = readByteArray("String", tex[k].get("qsFileName"));
                                textureProperty.type = tex[k].get("enType");

                                textureProperty.angle = tex[k].get("fSignedAngle");
                                textureProperty.translate = tex[k].get("v2Translation");
                                textureProperty.scale = tex[k].get("v2Size");

                                textureProperty.colorInverted = tex[k].get("bColorInverted");
                                textureProperty.intensity = tex[k].get("fIntensity");

                                material.texture.push(textureProperty);
                            }
                        }

                        zRestColorwayMaterials.colorwayMaterials.push(material);
                    }
                }

                this.materialInformationMap.set(id, zRestColorwayMaterials);
            }
        }

        var geometry = map.get("mapGeometry");
        if (geometry === undefined || geometry === null) {

            return false;
        }

        // 불투명 부터 추가해서 불투명 object 부터 그리기
        var tf = this.GetMatMeshs(geometry, zip, false, version);
        retObject.add(tf);

        // 투명한것 추가
        tf = this.GetMatMeshs(geometry, zip, true, version);
        retObject.add(tf);

        return retObject;
    },

    AddMatMeshList(zip, listMatShape, tf, bLoadTransparentObject, version) {

        for (let i = 0 ; i < listMatShape.length ; ++i) {


            var listMatMeshIDOnIndexedMesh = listMatShape[i].get("listMatMeshIDOnIndexedMesh");

            var mapShape = listMatShape[i].get("mapShape");
            if (mapShape === undefined || mapShape === null) {
                console.log("mapShape is null");
                return false;
            }

            var listIndexCount = mapShape.get("listIndexCount");
            if (listIndexCount === undefined || listIndexCount === null || listIndexCount.length == 0) {
                console.log("listIndexCount is null");
                return false;
            }

            // Draco Compression
            var dracoMeshFilename = readByteArray("String", mapShape.get("qsDracoFileName"));
            if (dracoMeshFilename === undefined || dracoMeshFilename === null) {
                console.log("cannot find dracoMesh");
                return false;
            }

            var drcArrayBuffer = zip.file(dracoMeshFilename).asArrayBuffer();

            const dracoLoader = new THREE.DRACOLoader();
            //dracoLoader.setVerbosity(1); // log 나오게 하려면 주석 풀자
            const dracoGeometry = dracoLoader.decodeDracoFile(drcArrayBuffer);

            //
            let totalIndexCount = 0;
            for (var m = 0; m < listIndexCount.length; ++m)
                totalIndexCount += listIndexCount[m];

            // Split MatShape to MatMesh
            var indexOffset = totalIndexCount;

            for (var m = 0; m < listIndexCount.length; ++m) {

                indexOffset = indexOffset - listIndexCount[m];

                // to Rayn 왜 이렇게 index 를 거꾸로 해야 제대로 렌더링되는지 원인을 모르겠음. 일단 이렇게 해서 되는 것 같지만 찜찜.. Jaden 2017.06.25
                var matMeshID = listMatMeshIDOnIndexedMesh[m].get("uiMatMeshID");
                var matProperty = this.materialInformationMap.get(matMeshID);
                var indexSize = listIndexCount[m];

                if (matProperty.colorwayMaterials[this.currentColorwayIndex].bPerfectTransparent) {
                    //indexOffset = indexOffset - listIndexCount[m+1];
                    continue;
                }

                if (bLoadTransparentObject)
                {
                    if (!matProperty.colorwayMaterials[this.currentColorwayIndex].bTransparent) {
                        //  indexOffset = indexOffset - listIndexCount[m + 1];
                        continue;
                    }
                }
                else {
                    if (matProperty.colorwayMaterials[this.currentColorwayIndex].bTransparent) {
                        //indexOffset = indexOffset - listIndexCount[m + 1];
                        continue;
                    }
                }

                // THREE.Geometry 를 사용하면 실제 메쉬의 메모리보다 10배 가까운 메모리를 사용하게 된다. 왜 그정도인지는 모르겠지만.. 그래서 BufferGeometry 사용한다 Jaden 2017.06.08
                var bufferGeometry = new THREE.BufferGeometry();

                // dracoGeometry의 해당 mesh 에 의해 사용된 vertex 들로만 새로운 메쉬를 만들기 위해 changeVertexIndex 만든다. 값은 새로운 메쉬에서의 vertexIndex. 초기값은 -1
                let changeVertexIndex = new Int32Array(dracoGeometry.vertices.length / 3);
                for (let j = 0; j < dracoGeometry.vertices.length / 3; j++)
                    changeVertexIndex[j] = -1;

                let posAttrib = new Array();
                let normalAttrib = new Array();
                let uvAttrib = new Array();
                let uv2Attrib = new Array();
                let count = 0;
                for (let j = 0; j < indexSize; j++) {
                    let index = dracoGeometry.indices[indexOffset + j];

                    if (changeVertexIndex[index] === -1) // 방문되지 않은 녀석들만 새로운 mesh vertex 로 추가한다.
                    {
                        changeVertexIndex[index] = count;
                        count++;

                        let threePos = new THREE.Vector3(dracoGeometry.vertices[index * 3], dracoGeometry.vertices[index * 3 + 1], dracoGeometry.vertices[index * 3 + 2]);
                        //threePos.applyMatrix4(m4);

                        posAttrib.push(threePos.x);
                        posAttrib.push(threePos.y);
                        posAttrib.push(threePos.z);

                        if (dracoGeometry.useNormal)
                        {
                            normalAttrib.push(dracoGeometry.normals[index * 3]);
                            normalAttrib.push(dracoGeometry.normals[index * 3 + 1]);
                            normalAttrib.push(dracoGeometry.normals[index * 3 + 2]);
                        }

                        uvAttrib.push(dracoGeometry.uvs[index * 2]);
                        uvAttrib.push(dracoGeometry.uvs[index * 2 + 1]);

                        if(dracoGeometry.numUVs >= 2)
                        {
                            uv2Attrib.push(dracoGeometry.uv2s[index * 2]);
                            uv2Attrib.push(dracoGeometry.uv2s[index * 2 + 1]);
                        }
                    }
                }
                bufferGeometry.addAttribute('position', new THREE.BufferAttribute(new Float32Array(posAttrib), 3));

                if (dracoGeometry.useNormal)
                    bufferGeometry.addAttribute('normal', new THREE.BufferAttribute(new Float32Array(normalAttrib), 3));

                bufferGeometry.addAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvAttrib), 2));
                if (dracoGeometry.numUVs >= 2)
                    bufferGeometry.addAttribute('uv2', new THREE.BufferAttribute(new Float32Array(uv2Attrib), 2));

                // Set Indices
                let indexAttrib = new Array();
                for (let j = indexSize / 3 - 1; j >= 0; j--) {
                    indexAttrib.push(changeVertexIndex[dracoGeometry.indices[indexOffset + j*3]]);
                    indexAttrib.push(changeVertexIndex[dracoGeometry.indices[indexOffset + j*3+1]]);
                    indexAttrib.push(changeVertexIndex[dracoGeometry.indices[indexOffset + j*3+2]]);
                }

                bufferGeometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indexAttrib), 1));

                if (!dracoGeometry.useNormal) {
                    bufferGeometry.computeFaceNormals();
                    bufferGeometry.computeVertexNormals();
                }

                var material = this.makeMaterialForZrest(zip, matProperty, this.currentColorwayIndex, dracoGeometry.numUVs >= 2, version);
                //  var material = new THREE.MeshPhongMaterial();
                //material.color = new THREE.Color(0xAAAAAA);
                //material.side = THREE.DoubleSide;
                //material.wireframe = true;

                // var material = new THREE.MeshLambertMaterial({ color: 0xffffff, envMap: envDiffuseMap });


                var threeMesh = new THREE.Mesh(bufferGeometry, material);
                threeMesh.userData = matMeshID;
                threeMesh.castShadow = true;
                threeMesh.receiveShadow = true;
                tf.add(threeMesh);
                // Global._globalMatMeshInformationList.push(threeMesh);
                this.matMeshList.push(threeMesh);

                //indexOffset = indexOffset - listIndexCount[m + 1];

                //console.log(indexOffset);
            }
        }
    },


    GetMatMeshs(map, zip, bLoadTransparentObject, version) {
        //var matMeshArray = new Array();
        var tf = new THREE.Object3D();

        var listChildrenTransformer3D = map.get("listChildrenTransformer3D");
        if (listChildrenTransformer3D !== undefined && listChildrenTransformer3D !== null) {
            for (let i = 0; i < listChildrenTransformer3D.length; ++i) {
                var childTF3D = listChildrenTransformer3D[i];
                var childTF = this.GetMatMeshs(childTF3D, zip, bLoadTransparentObject, version);
                tf.add(childTF);
            }
        }

        var mapTransformer3D = map.get("mapTransformer3D");
        if (mapTransformer3D !== undefined && mapTransformer3D !== null) {
            var childTF = this.GetMatMeshs(mapTransformer3D, zip, bLoadTransparentObject, version);
            //tf.add(childTF);
            tf = childTF;
        }


        let mat4 = new THREE.Matrix4().identity();

        /*if (map.get("m4LtoW") !== undefined) {
            const m4LtoW = map.get("m4LtoW");

            mat4.set(m4LtoW.a00, m4LtoW.a01, m4LtoW.a02, m4LtoW.a03,
                    m4LtoW.a10, m4LtoW.a11, m4LtoW.a12, m4LtoW.a13,
                    m4LtoW.a20, m4LtoW.a21, m4LtoW.a22, m4LtoW.a23,
                    m4LtoW.a30, m4LtoW.a31, m4LtoW.a32, m4LtoW.a33);
        }*/

        if (map.get("m4Matrix") !== undefined) {
            const localMatrix = map.get("m4Matrix");
            mat4.set(localMatrix.a00, localMatrix.a01, localMatrix.a02, localMatrix.a03,
                localMatrix.a10, localMatrix.a11, localMatrix.a12, localMatrix.a13,
                localMatrix.a20, localMatrix.a21, localMatrix.a22, localMatrix.a23,
                localMatrix.a30, localMatrix.a31, localMatrix.a32, localMatrix.a33);

        }

        tf.applyMatrix(mat4);

        var listMatShape = map.get("listMatShape");
        if (listMatShape !== undefined && listMatShape !== null) {
            this.AddMatMeshList(zip, listMatShape, tf, bLoadTransparentObject, version);
        }

        return tf;
    },


    makeMaterialForZrest(zip, property, colorwayIndex, bUseSeamPuckeringNormalMap, version) {

        var zRestColorwayMaterialArray = property.colorwayMaterials;
        let material = zRestColorwayMaterialArray[colorwayIndex];

        let rFace;
        if(material.renderFace === undefined)
            rFace = THREE.FrontSide;// 기본값은 두께보기의상이 기본이므로 front로 하자. double 이 아닌 front로 하면 아바타 헤어 투명도가 CLO와 다르게 나오는 문제가 생기긴 하지만
        else if (material.renderFace === RenderFace.MV_DOUBLE_FACE)
            rFace = THREE.DoubleSide;
        else if (material.renderFace === RenderFace.MV_FRONT_FACE)
            rFace = THREE.FrontSide;
        else
            rFace = THREE.BackSide;

        let uniforms;
        if(version <=2)
        {
            uniforms = {
                matGlobal: { type: "m4", value: new THREE.Matrix4().identity() },
                matAmbient: { type: "m4", value: new THREE.Matrix4().identity() },
                matDiffuse: { type: "m4", value: new THREE.Matrix4().identity() },
                matSpecular: { type: "m4", value: new THREE.Matrix4().identity() },
                matNormal: { type: "m4", value: new THREE.Matrix4().identity() },
                matTransparent: { type: "m4", value: new THREE.Matrix4().identity() },
                gRotMatrix: { type: "m4", value: new THREE.Matrix4().identity() },
                gTransMatrix: { type: "m4", value: new THREE.Matrix4().identity() },
                sGlobal: { type: 't', value: null },
                sAmbient: { type: 't', value: null },
                sDiffuse: { type: 't', value: null },
                sSpecular: { type: 't', value: null },
                sNormal: { type: 't', value: null },
                sTransparent: { type: 't', value: null },
                bUseGlobal: { type: 'i', value: 0 },
                bUseAmbient: { type: 'i', value: 0 },
                bUseDiffuse: { type: 'i', value: 0 },
                bUseSpecular: { type: 'i', value: 0 },
                bUseNormal: { type: 'i', value: 0 },
                bUseTransparent: { type: 'i', value: 0 },

                materialAmbient: { type: "v3", value: zRestColorwayMaterialArray[colorwayIndex].ambient },
                materialDiffuse: { type: "v3", value: zRestColorwayMaterialArray[colorwayIndex].diffuse },
                materialSpecular: { type: "v3", value: zRestColorwayMaterialArray[colorwayIndex].specular },
                materialEmission: { type: "v3", value: zRestColorwayMaterialArray[colorwayIndex].emission },
                materialShininess: { type: 'f', value: zRestColorwayMaterialArray[colorwayIndex].shininess },
                materialOpacity: { type: 'f', value: zRestColorwayMaterialArray[colorwayIndex].alpha },
                normalMapIntensityInPercentage: { type: 'f', value: zRestColorwayMaterialArray[colorwayIndex].normalMapIntensityInPercentage }
            }
        }
        // version == 3
        else
        {
            uniforms = {
                m_bUseMetalnessRoughnessPBR: { type: 'i', value:  zRestColorwayMaterialArray[colorwayIndex].bUseMetalnessRoughnessPBR},
                m_Metalness: { type: 'f', value: zRestColorwayMaterialArray[colorwayIndex].metalness },
                m_Glossiness: { type: 'f', value: zRestColorwayMaterialArray[colorwayIndex].glossiness },
                m_bInvertGlossinessMap: { type: 'i', value: 0 }, // 아래 텍스처 로드하면서 설정
                m_GlossinessMapIntensity: { type: 'f', value: 1.0 }, // 아래서 설정
                //m_EnvironmentAngle: { type: 'f', value: 0.0 }, // 나중에 zprj 파일에서 읽자
                m_EnvironmentLightIntensity: { type: 'f', value: zRestColorwayMaterialArray[colorwayIndex].environmentLightIntensity },
                m_CameraLightIntensity: { type: 'f', value: zRestColorwayMaterialArray[colorwayIndex].cameraLightIntensity },
                m_ReflectionIntensity: { type: 'f', value: zRestColorwayMaterialArray[colorwayIndex].reflectionIntensity },
                m_RoughnessUIType: { type: 'i', value: zRestColorwayMaterialArray[colorwayIndex].roughnessUIType },
                m_FrontColorMult: { type: 'f', value: zRestColorwayMaterialArray[colorwayIndex].frontColorMult },
                m_SideColorMult: { type: 'f', value: zRestColorwayMaterialArray[colorwayIndex].sideColorMult },

                materialBaseColor: { type: "v3", value: zRestColorwayMaterialArray[colorwayIndex].base },
                materialSpecular: { type: "v3", value: zRestColorwayMaterialArray[colorwayIndex].reflectionColor },
                materialOpacity: { type: 'f', value: zRestColorwayMaterialArray[colorwayIndex].alpha },
                normalMapIntensityInPercentage: { type: 'f', value: zRestColorwayMaterialArray[colorwayIndex].normalMapIntensityInPercentage },

                // 아래는 texture 정보에서 설정
                bUseGlobal: { type: 'i', value: 0 },
                bUseNormal: { type: 'i', value: 0 },
                bUseSeamPuckeringNormal: { type: 'i', value: 0 },
                bUseTransparent: { type: 'i', value: 0 },
                bUseGlossinessMap: { type: 'i', value: 0 },
                bUseMetalnessMap: { type: 'i', value: 0 },
                bUseAmbientOcclusion: { type: 'i', value: 0 },

                matGlobal: { type: "m4", value: new THREE.Matrix4().identity() },
                matNormal: { type: "m4", value: new THREE.Matrix4().identity() },
                matTransparent: { type: "m4", value: new THREE.Matrix4().identity() },
                matGlossiness: { type: "m4", value: new THREE.Matrix4().identity() },
                matMetalness: { type: "m4", value: new THREE.Matrix4().identity() },

                gRotMatrix: { type: "m4", value: new THREE.Matrix4().identity() },
                gTransMatrix: { type: "m4", value: new THREE.Matrix4().identity() },

                sGlobal: { type: 't', value: null },
                sNormal: { type: 't', value: null },
                sSeamPuckeringNormal: { type: 't', value: null },
                sTransparent: { type: 't', value: null },
                sGlossiness: { type: 't', value: null },
                sMetalness: { type: 't', value: null },
                sDiffuseEnvironmentMap: { type: 't', value: null }, // 여기서 바로 value: envDiffuseMap 으로 설정하면 안먹힌다.
                sSpecularEnvironmentMap: { type: 't', value: null } // 여기서 바로 value: envDiffuseMap 으로 설정하면 안먹힌다.
                //uniform sampler2D sAmbientOcclusionMap;
            }
        }
        //index is one of texture list. this value only zero now.
        let threeJSMaterial = new THREE.ShaderMaterial({
            uniforms: THREE.UniformsUtils.merge([
                THREE.UniformsLib['lights'], uniforms
            ]),
            vertexShader: null,
            fragmentShader: null,
            side: rFace, // double side로 하면 zfighting이 생각보다 심해진다. 나중에 이문제 해결 필요
            wireframe: drawMode.wireframe.pattern,
            lights: true,
            polygonOffset: property.bPolygonOffset,
            polygonOffsetFactor: -0.5,
            polygonOffsetUnits: -2.0,

            //blending: THREE.MultiplyBlending,
            //blendSrc: THREE.SrcAlphaFactor,
            //blendDst: THREE.oneMinusSrcAlphaFactor,
            depthWrite: !material.bTransparent,
            //depthTest: true,
            transparent: true
        });

        threeJSMaterial.extensions.derivatives = true;
        threeJSMaterial.extensions.shaderTextureLOD = true;

        if (version <= 2) {
            threeJSMaterial.vertexShader = vertexShader
            threeJSMaterial.fragmentShader = fragmentShader
        }
        else
        {
            threeJSMaterial.vertexShader = pbrVertexShader
            threeJSMaterial.fragmentShader = pbrFragmentShader

            threeJSMaterial.uniforms.sDiffuseEnvironmentMap.value = envDiffuseMap;
            threeJSMaterial.uniforms.sSpecularEnvironmentMap.value = envSpecularMap;
        }

        if (gSeamPuckeringNormalMap !== null && bUseSeamPuckeringNormalMap)
        {
            threeJSMaterial.uniforms.bUseSeamPuckeringNormal.value = bUseSeamPuckeringNormalMap;
            threeJSMaterial.uniforms.sSeamPuckeringNormal.value = gSeamPuckeringNormalMap;
        }


        // Load Texture File.

        var bRenderTexture = false;

        for (let i = 0; i < zRestColorwayMaterialArray[colorwayIndex].texture.length; i++) {
            let zRestTexture = zRestColorwayMaterialArray[colorwayIndex].texture[i];

            if (!zip.file(zRestTexture.file)) {
                let temp = zRestTexture.file;

                let list = temp.split('/');
                let textureFileName = list[list.length - 1];

                if (!zip.file(textureFileName)) {
                }
                else
                {
                    // 이 쓰레드에서 바로 texture 로딩해 버리자. 이미지 사이즈가 작으면 이게 사용자가 봤을 때 깜박거리지 않고 오히려 낫다.
                    // 나중에 큰 이미지 프로그레시브 로딩 적용할 때 다시 비동기 방식 적용해 보자. 비동기 로딩 방식은 아래 주석처리되어 있다. Jaden 2017.016.16

                    var texture = _gNameToTextureMap.get(textureFileName);
                    if (!texture) {

                        texture = this.LoadTexture(zip, textureFileName);

                        _gNameToTextureMap.set(textureFileName, texture);

                        console.log("texture name" + textureFileName);
                    }

                    // wrap type 외에는 기본값을 그대로 사용하면 된다.
                    texture.wrapS = THREE.RepeatWrapping;
                    texture.wrapT = THREE.RepeatWrapping;

                    var rotMatrix = new THREE.Matrix4();
                    rotMatrix.identity();
                    rotMatrix.makeRotationZ(-THREE.Math.degToRad(zRestTexture.angle));

                    var transMatrix = new THREE.Matrix4();
                    transMatrix.identity();
                    transMatrix.makeTranslation(-zRestTexture.translate.x, -zRestTexture.translate.y, 0.0);

                    var scaleMatrix = new THREE.Matrix4();
                    scaleMatrix.identity();
                    scaleMatrix.makeScale(1.0 / zRestTexture.scale.x, 1.0 / zRestTexture.scale.y, 1.0);

                    var transform = new THREE.Matrix4();
                    transform.identity();
                    transform.multiply(scaleMatrix);
                    transform.multiply(rotMatrix);
                    transform.multiply(transMatrix);

                    if (zRestTexture.type === TextureType.GLOBAL_MAP) {
                        threeJSMaterial.uniforms.sGlobal.value = texture;
                        threeJSMaterial.uniforms.bUseGlobal.value = 1;
                        threeJSMaterial.uniforms.matGlobal.value = transform;
                    }
                    else if (zRestTexture.type === TextureType.DIFFUSE_MAP) {
                        if (version <= 2) {
                            threeJSMaterial.uniforms.sDiffuse.value = texture;
                            threeJSMaterial.uniforms.bUseDiffuse.value = 1;
                            threeJSMaterial.uniforms.matDiffuse.value = transform;
                        }
                    }
                    else if (zRestTexture.type === TextureType.AMBIENT_MAP) {
                        if (version <= 2) {
                            threeJSMaterial.uniforms.sAmbient.value = texture;
                            threeJSMaterial.uniforms.bUseAmbient.value = 1;
                            threeJSMaterial.uniforms.matAmbient.value = transform;
                        }
                    }
                    else if (zRestTexture.type === TextureType.SPECULAR_MAP) {
                        if (version <= 2) {
                            threeJSMaterial.uniforms.sSpecular.value = texture;
                            threeJSMaterial.uniforms.bUseSpecular.value = 1;
                            threeJSMaterial.uniforms.matSpecular.value = transform;
                        }
                    }
                    else if (zRestTexture.type === TextureType.NORMAL_MAP) {
                        if (version >= 2) { // 버전 2 이상일 때만 노말맵 지원. 그렇지 않으면 1.0에서 제작된 zrest 파일은 desaturated 된 이미지가 normal map 으로 인식되었던 버그때문에 렌더링 이상해진다.
                            threeJSMaterial.uniforms.sNormal.value = texture;
                            threeJSMaterial.uniforms.bUseNormal.value = 1;
                            threeJSMaterial.uniforms.matNormal.value = transform;
                        }
                    }
                    else if (zRestTexture.type === TextureType.TRANSPARENTT_MAP) {
                        threeJSMaterial.uniforms.sTransparent.value = texture;
                        threeJSMaterial.uniforms.bUseTransparent.value = 1;
                        threeJSMaterial.uniforms.matTransparent.value = transform;
                    }
                    else if (zRestTexture.type === TextureType.GLOSSINESS_MAP) {
                        if (version >= 3) {
                            threeJSMaterial.uniforms.sGlossiness.value = texture;
                            threeJSMaterial.uniforms.bUseGlossinessMap.value = 1;
                            threeJSMaterial.uniforms.matGlossiness.value = transform;

                            if (zRestTexture.colorInverted)
                                threeJSMaterial.uniforms.m_bInvertGlossinessMap.value = 1;
                            else
                                threeJSMaterial.uniforms.m_bInvertGlossinessMap.value = 0;

                            threeJSMaterial.uniforms.m_GlossinessMapIntensity.value = zRestTexture.intensity;
                        }

                    }
                    /*else if (zRestTexture.type === TextureType.METALNESS_MAP) {
                        threeJSMaterial.uniforms.sMetalness.value = texture;
                        threeJSMaterial.uniforms.bUseMetalnessMap.value = 1;
                        threeJSMaterial.uniforms.matMetalness.value = transform;
                    }*/
                    /*
                    // 아래는 비동기 로딩을 위해 worker 사용하는 경우.
                    LoadMaterialTexture(threeJSMaterial, zip, textureFileName, function (resultTexture) {


                        if (zRestTexture.type === TextureType.GLOBAL_MAP) {
                            threeJSMaterial.uniforms.sGlobal.value = resultTexture;
                            threeJSMaterial.uniforms.bUseGlobal.value = 1;
                        }
                        else if (zRestTexture.type === TextureType.DIFFUSE_MAP) {
                            threeJSMaterial.uniforms.sDiffuse.value = resultTexture;
                            threeJSMaterial.uniforms.bUseDiffuse.value = 1;
                        }
                        else if (zRestTexture.type === TextureType.AMBIENT_MAP) {
                            threeJSMaterial.uniforms.sAmbient.value = resultTexture;
                            threeJSMaterial.uniforms.bUseAmbient.value = 1;
                        }
                        else if (zRestTexture.type === TextureType.SPECULAR_MAP) {
                            threeJSMaterial.uniforms.sSpecular.value = resultTexture;
                            threeJSMaterial.uniforms.bUseSpecular.value = 1;
                        }
                        else if (zRestTexture.type === TextureType.NORMAL_MAP) {
                        if (version >= 2) { // 버전 2 이상일 때만 노말맵 지원. 그렇지 않으면 1.0에서 제작된 zrest 파일은 desaturated 된 이미지가 normal map 으로 인식되었던 버그때문에 렌더링 이상해진다.
                            threeJSMaterial.uniforms.sNormal.value = resultTexture;
                            threeJSMaterial.uniforms.bUseNormal.value = 1;
                            }
                        }
                        else if (zRestTexture.type === TextureType.TRANSPARENTT_MAP) {
                            threeJSMaterial.uniforms.sTransparent.value = texture;
                            threeJSMaterial.uniforms.bUseTransparent.value = 1;
                        }
                    });*/

                    bRenderTexture = true;
                }
            }
        }

        if (bRenderTexture) {


            if (property.colorwayObjectTextureTransformation.length > 0) {
                var grot = new THREE.Matrix4();
                grot.identity();
                grot.makeRotationZ(-THREE.Math.degToRad(property.colorwayObjectTextureTransformation[colorwayIndex].angle));

                var gtra = new THREE.Matrix4();
                gtra.identity();
                gtra.makeTranslation(-property.colorwayObjectTextureTransformation[colorwayIndex].translate.x, -property.colorwayObjectTextureTransformation[colorwayIndex].translate.y, 0.0);

                threeJSMaterial.uniforms.gRotMatrix.value = grot;
                threeJSMaterial.uniforms.gTransMatrix.value = gtra;
            }
        }
        return threeJSMaterial;
    }
};



/*

function AddMatMeshList(zip, listMatShape, tf, bLoadTransparentObject, version) {
    
    for (let i = 0 ; i < listMatShape.length ; ++i) {


        var listMatMeshIDOnIndexedMesh = listMatShape[i].get("listMatMeshIDOnIndexedMesh");

        var mapShape = listMatShape[i].get("mapShape");
        if (mapShape === undefined || mapShape === null) {
            console.log("mapShape is null");
            return false;
        }

        var listIndexCount = mapShape.get("listIndexCount");
        if (listIndexCount === undefined || listIndexCount === null || listIndexCount.length == 0) {
            console.log("listIndexCount is null");
            return false;
        }

        // Draco Compression
        var dracoMeshFilename = readByteArray("String", mapShape.get("qsDracoFileName"));
        if (dracoMeshFilename === undefined || dracoMeshFilename === null) {
            console.log("cannot find dracoMesh");
            return false;
        }

        var drcArrayBuffer = zip.file(dracoMeshFilename).asArrayBuffer();

        const dracoLoader = new THREE.DRACOLoader();
        dracoLoader.setVerbosity(1);
        dracoLoader.decodeDracoFile(drcArrayBuffer, function (dracoGeometry) {
            
            // 
            let totalIndexCount = 0;
            for (var m = 0; m < listIndexCount.length; ++m)
                totalIndexCount += listIndexCount[m];

            // Split MatShape to MatMesh
            //var indexOffset = totalIndexCount;
            var indexOffset = 0;

            for (var m = 0; m < listIndexCount.length; ++m) {

                //indexOffset = indexOffset - listIndexCount[m];

                // to Rayn 왜 이렇게 index 를 거꾸로 해야 제대로 렌더링되는지 원인을 모르겠음. 일단 이렇게 해서 되는 것 같지만 찜찜.. Jaden 2017.06.25
                var matMeshID = listMatMeshIDOnIndexedMesh[m].get("uiMatMeshID");
                var matProperty = _globalMaterialInformationMap.get(matMeshID);
                var indexSize = listIndexCount[m];

                if (matProperty.colorwayMaterials[_globalCurrentColorwayIndex].bPerfectTransparent) {
                    indexOffset += listIndexCount[m];
                    continue;
                }

                if (bLoadTransparentObject) {
                    if (!matProperty.colorwayMaterials[_globalCurrentColorwayIndex].bTransparent) {
                        indexOffset += listIndexCount[m];
                        continue;
                    }
                }
                else {
                    if (matProperty.colorwayMaterials[_globalCurrentColorwayIndex].bTransparent) {
                        indexOffset += listIndexCount[m];
                        continue;
                    }
                }

                // THREE.Geometry 를 사용하면 실제 메쉬의 메모리보다 10배 가까운 메모리를 사용하게 된다. 왜 그정도인지는 모르겠지만.. 그래서 BufferGeometry 사용한다 Jaden 2017.06.08
                var bufferGeometry = new THREE.BufferGeometry();

                let dracoVertices = dracoGeometry.getAttribute('position').array;
                let dracoUVs = dracoGeometry.getAttribute('uv').array;
                let dracoIndices = dracoGeometry.index.array;
                let dracoVertexCount = dracoGeometry.getAttribute('position').count;

                // dracoGeometry의 해당 mesh 에 의해 사용된 vertex 들로만 새로운 메쉬를 만들기 위해 changeVertexIndex 만든다. 값은 새로운 메쉬에서의 vertexIndex. 초기값은 -1
                let changeVertexIndex = new Int32Array(dracoVertexCount);
                for (let j = 0; j < dracoVertexCount; j++)
                    changeVertexIndex[j] = -1;

                let posAttrib = new Array();
                let uvAttrib = new Array();
                let uv2Attrib = new Array();
                let count = 0;
                for (let j = 0; j < indexSize; j++) {
                    let index = dracoIndices[indexOffset + j];

                    if (changeVertexIndex[index] === -1) // 방문되지 않은 녀석들만 새로운 mesh vertex 로 추가한다. 
                    {
                        changeVertexIndex[index] = count;
                        count++;

                        let threePos = new THREE.Vector3(dracoVertices[index * 3], dracoVertices[index * 3 + 1], dracoVertices[index * 3 + 2]);
                        //threePos.applyMatrix4(m4);

                        posAttrib.push(threePos.x);
                        posAttrib.push(threePos.y);
                        posAttrib.push(threePos.z);

                        uvAttrib.push(dracoUVs[index * 2]);
                        uvAttrib.push(dracoUVs[index * 2 + 1]);

                        //if(dracoGeometry.numUVs >= 2)
                        //{
                          //  uv2Attrib.push(dracoGeometry.uv2s[index * 2]);
                            //uv2Attrib.push(dracoGeometry.uv2s[index * 2 + 1]);
                        //}
                    }
                }
                bufferGeometry.addAttribute('position', new THREE.BufferAttribute(new Float32Array(posAttrib), 3));
                bufferGeometry.addAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvAttrib), 2));
               // if (dracoGeometry.numUVs >= 2)
                 //   bufferGeometry.addAttribute('uv2', new THREE.BufferAttribute(new Float32Array(uv2Attrib), 2));

                // Set Indices
                let indexAttrib = new Array();
                for (let j = 0; j < indexSize; j++) {

                    if (changeVertexIndex[dracoIndices[indexOffset + j]] == -1) {
                        let sdfa = new Array();
                    }

                    indexAttrib.push(changeVertexIndex[dracoIndices[indexOffset + j]]);                    
                }

                bufferGeometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indexAttrib), 1));

                bufferGeometry.computeFaceNormals();
                bufferGeometry.computeVertexNormals();

                //var material = makeMaterialForZrest(zip, matProperty, _globalCurrentColorwayIndex, dracoGeometry.numUVs >= 2, version);
                var material = makeMaterialForZrest(zip, matProperty, _globalCurrentColorwayIndex, false, version);
                //  var material = new THREE.MeshPhongMaterial();
                //material.color = new THREE.Color(0xAAAAAA);
                //material.side = THREE.DoubleSide;
                //material.wireframe = true;

                // var material = new THREE.MeshLambertMaterial({ color: 0xffffff, envMap: envDiffuseMap });


                var threeMesh = new THREE.Mesh(bufferGeometry, material);
                threeMesh.userData = matMeshID;
                tf.add(threeMesh);
                _globalMatMeshInformationList.push(threeMesh);

                indexOffset += listIndexCount[m];

                //console.log(indexOffset);
            }
        });
    }
}

*/



export function dataWorkerFunction() {
    self.addEventListener('message', function (e) {
        try {
            var reader = new FileReaderSync();
            var url = reader.readAsDataURL(e.data.Blob);
            postMessage({ Result: 'FileReaderSync() complete', URL: url });
        } catch (e) {
            postMessage({
                result: 'error'
            });
        }
    }, false);
}

function makeWorker(script) {

    var URL = window.URL || window.webkitURL;
    var Blob = window.Blob;
    var worker = window.Worker;

    if (!URL || !Blob || !Worker || !script)
        return null;

    var blob = new Blob([script]);
    var worker = new Worker(URL.createObjectURL(blob));
    return worker;

}

export function checkFileReaderSyncSupport() {

    var worker = makeWorker(syncDetectionScript);
    if (worker) {
        worker.onmessage = function (e) {
            FileReaderSyncSupport = e.data;
            if (FileReaderSyncSupport) {
                console.log("Your browser supports FileReaderSync.");
            }
        };
        worker.postMessage({});
    }

}

function LoadMaterialTexture(material, zip, textureFileName, onload) {
    if (!FileReaderSyncSupport)
        return null;

    var syncWorker = new Worker(dataSyncWorkerURL);

    if (syncWorker) {
        ++_globalWorkerCount;
        _globalWorkerCreateFlag = true;

        syncWorker.onmessage = function (e) {

            var texture = _gNameToTextureMap.get(textureFileName);
            if (!texture) {
                var arraybuffer = zip.file(textureFileName).asArrayBuffer();
                var bytes = new Uint8Array(arraybuffer);
                var blob = new Blob([bytes.buffer]);
                var url = URL.createObjectURL(blob);

                var loader = new THREE.TextureLoader();
                texture = loader.load(url);

                _gNameToTextureMap.set(textureFileName, texture);

                console.log("texture file name: " + textureFileName);
            }

            /*
            var arraybuffer = zip.file(textureFileName).asArrayBuffer();
            var bytes = new Uint8Array(arraybuffer);
            var blob = new Blob([bytes.buffer]);
            var url = URL.createObjectURL(blob);

            var loader = new THREE.TextureLoader();
            var texture = loader.load(url);*/

            // wrap type 외에는 기본값을 그대로 사용하면 된다.
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;

            onload(texture);

            this.terminate();
            --_globalWorkerCount;

            if (_globalWorkerCount === 0) {
                _globalCompleteLoadFile = true;
                //console.log("load complete");
            }

            console.log("worker count = " + _globalWorkerCount);
        };

        syncWorker.postMessage("plz");
    }
}
