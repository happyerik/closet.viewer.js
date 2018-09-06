import ZRestLoader, { dataWorkerFunction, checkFileReaderSyncSupport } from './lib/clo/readers/ZrestReader'
import * as THREE from '@/lib/threejs/three'
import '@/lib/threejs/OrbitControls'
import '@/lib/draco/DRACOLoader'
//import '@/lib/clo/UtilFunctions'

var container, states;
var camera, scene, renderer, controls;
var background_camera, background_scene;
var mouseX = 0, mouseY = 0;
var windowHalfX = window.innerWidth / 2;
var windowHalfY = window.innerHeight / 2;

var reader;
var progress = document.querySelector('.percent');
var dataSyncWorkerURL = URL.createObjectURL(new Blob(["(" + dataWorkerFunction.toString() + ")()"], { type: 'text/javascript' }));
var timerId = 0;


checkFileReaderSyncSupport();

var cameraHeight = 1100;
var cameraDistance = 5000;

var envDiffuseMap = null;
var envSpecularMap = null;

var intProgress = 0;

// var setter = null

let requestId = null


export default class ClosetViewer {
    constructor() {
        this.init = this.init.bind(this)
        this.render = this.render.bind(this)
        this.loadZrestUrl = this.loadZrestUrl.bind(this)
        this.getCameraMatrix = this.getCameraMatrix.bind(this)
        this.setCameraMatrix = this.setCameraMatrix.bind(this)

        this.setWindowSize = this.setWindowSize.bind(this)
        this.onWindowResize = this.onWindowResize.bind(this)

        this.changeColorway = this.changeColorway.bind(this)
        this.getColorwaySize = this.getColorwaySize.bind(this)
        this.onUpdateCamera = this.onUpdateCamera.bind(this)
        this.stopRender = this.stopRender.bind(this)

        this.object3D = null
    }

    init({ width, height, element, cameraPosition = null }) {

        var w = width;
        var h = height;
        this.setter = element;
        this.id = element;
        this.cameraPosition = cameraPosition

        windowHalfX = w / 2;
        windowHalfY = h / 2;

        //create webgl renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true  });
        this.renderer.setClearColor(0xcccccc);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(w, h);
        this.renderer.sortObjects = false; // 투명 object 제대로 렌더링하려면 자동 sort 꺼야 한다
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        document.getElementById(this.setter).appendChild(this.renderer.domElement);

        //create camera
        this.camera = new THREE.PerspectiveCamera(15, w / h, 100, 100000);
        this.camera.position.y = cameraHeight;
        this.camera.position.z = cameraDistance;

        //create camera controller
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.target = new THREE.Vector3(0, cameraHeight, 0);
        this.controls.update();
        this.controls.addEventListener('change', () => {
            if(this.updateCamera) this.updateCamera({ position: this.camera.position, id: this.id })
            this.render()
        });


        //create scenegraph
        this.scene = new THREE.Scene();

        // 이제 version 3 이후 파일에 대해서는 shader에서 light 설정을 hard coding해서 사용한다. 하지만 version 2 이하 파일을 위해 여기에서도 설정한다.
        var DirLight0 = new THREE.DirectionalLight(0xd2d2d2);
        DirLight0.position.set(0, 0, 1).normalize();
        DirLight0.castShadow = false;
        // specular1 : 464646

        var DirLight1 = new THREE.DirectionalLight(0x6e6e6e);
        DirLight1.position.set(1500, 3000, 1500);
        DirLight1.castShadow = true;


        //Set up shadow properties for the light
        DirLight1.shadow.mapSize.width = 2048;  // default
        DirLight1.shadow.mapSize.height = 2048; // default
        DirLight1.shadow.camera.near = 2000;    // default
        DirLight1.shadow.camera.far = 7000;     // default
        DirLight1.shadow.camera.right = 1500;
        DirLight1.shadow.camera.left = -1500;
        DirLight1.shadow.camera.top = 1500;
        DirLight1.shadow.camera.bottom = -1500;
        DirLight1.shadow.bias = -0.001;

        // specular2 : 3c3c3c

        //scene.add(new THREE.AmbientLight(0x8c8c8c));// amibent light은 추가하지 않고 shader에서 하드코딩으로 처리한다. CLO와 three.js 의 light 구조가 다르므로 이렇게 하자
        this.scene.add(DirLight0);
        this.scene.add(DirLight1);

        var loader = new THREE.TextureLoader();
        var texture = loader.load(require('@/lib/clo/background/img_3dwindow_bg_Designer.png'));
        this.backgroundMesh = new THREE.Mesh(
            new THREE.PlaneGeometry(2, 2, 0),
            new THREE.MeshBasicMaterial({
                map: texture
            })
        );

        this.backgroundMesh.material.depthTest = false;
        this.backgroundMesh.material.depthWrite = false;

        this.background_scene = new THREE.Scene();
        this.background_camera = new THREE.Camera();

        this.background_scene.add(this.background_camera);
        this.background_scene.add(this.backgroundMesh);

        // floor
        /* var planeGeometry = new THREE.PlaneBufferGeometry(10000, 10000, 2, 2);
         var planeMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00, opacity: 0.2 })
         var plane = new THREE.Mesh(planeGeometry, planeMaterial);
         plane.receiveShadow = true;

         let quaternion = new THREE.Quaternion();
         quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
         plane.quaternion.copy(quaternion);

         scene.add(plane);*/

        //Create a helper for the shadow camera (optional)
        //var helper = new THREE.CameraHelper(light.shadow.camera);
        //scene.add(helper);

        // canvas event
        var canvas = document.getElementById(this.setter);
        canvas.addEventListener("mouseout", () => this.controls.noPan = true, false);
        canvas.addEventListener("mouseover", () => this.controls.noPan = false, false);

        this.animate()
    }

    getCameraMatrix() {
        let matrix = [];

        matrix.push(this.camera.matrix.elements[0]);
        matrix.push(this.camera.matrix.elements[4]);
        matrix.push(this.camera.matrix.elements[8]);
        matrix.push(this.camera.matrix.elements[12]);
        matrix.push(this.camera.matrix.elements[1]);
        matrix.push(this.camera.matrix.elements[5]);
        matrix.push(this.camera.matrix.elements[9]);
        matrix.push(this.camera.matrix.elements[13]);
        matrix.push(this.camera.matrix.elements[2]);
        matrix.push(this.camera.matrix.elements[6]);
        matrix.push(this.camera.matrix.elements[10]);
        matrix.push(this.camera.matrix.elements[14]);

        return matrix;
    }

    setCameraMatrix(mat, bUpdateRendering) {
        if(mat !== undefined && mat.length === 12)
        {
            this.camera.matrix.elements[0] = mat[0];
            this.camera.matrix.elements[4] = mat[1];
            this.camera.matrix.elements[8] = mat[2];
            this.camera.matrix.elements[12] = mat[3];
            this.camera.matrix.elements[1] = mat[4];
            this.camera.matrix.elements[5] = mat[5];
            this.camera.matrix.elements[9] = mat[6];
            this.camera.matrix.elements[13] = mat[7];
            this.camera.matrix.elements[2] = mat[8];
            this.camera.matrix.elements[6] = mat[9];
            this.camera.matrix.elements[10] = mat[10];
            this.camera.matrix.elements[14] = mat[11];

            if(bUpdateRendering === true)
                this.render();
        }
    }

    setWindowSize(w, h) {

        windowHalfX = w / 2;
        windowHalfY = h / 2;

        this.renderer.setSize(w, h);

        this.camera.aspect = w / h;
    }

    onWindowResize(datas) {
        var data = {
            width : screen.width,
            height : screen.height,
            fullscreen : false,
            marketplace : false,
            reponsive : false,
        }
        $.extend(data, datas);

        if (data.fullscreen || data.responsive) {
            windowHalfX = data.width / 2;
            windowHalfY = data.height / 2;

            this.camera.aspect = data.width / data.height;
            this.camera.updateProjectionMatrix();

            this.renderer.setSize(data.width, data.height);
        } else {
            if (data.marketplace)
            {
                windowHalfX = 520;
                windowHalfY = 650;

                this.camera.aspect = 520 / 650;
                this.camera.updateProjectionMatrix();

                this.renderer.setSize(520, 650);
            } else {
                windowHalfX = 650;
                windowHalfY = 750;

                this.camera.aspect = 650 / 750;
                this.camera.updateProjectionMatrix();

                this.renderer.setSize(650, 750);
            }
        }
    }
    animate() {
        requestAnimationFrame(this.animate.bind(this));
        this.controls.update();
        this.render();
    }

    render() {
        this.renderer.autoClear = false;
        this.renderer.clear();
        this.renderer.render(this.background_scene, this.background_camera);
        this.renderer.render(this.scene, this.camera);

    }

    stopRender() {
        if (requestId) {
            window.cancelAnimationFrame(requestId);
            this.scene = null;
            this.camera = null;
            this.controls = null;
            this.renderer = null;
            requestId = undefined;
        }
    }

    onUpdateCamera(callback) {
        this.updateCamera = callback
    }

    loadZrestUrl(url, onProgress, onLoad) {
        if(url === ''){
            return
        }

        let tmpCameraMatrix;
        let tmpColorwayIndex;
        this.loadZrestUrlWithParameters(url, tmpCameraMatrix, tmpColorwayIndex, onProgress, onLoad);

    }

    loadZrestUrlWithParameters(url, cameraMatrix, colorwayIndex, onProgress, onLoad) {
        // var $el = $('#detail_viewer');
        // // progress bar -- by terry
        // $el.append('<div class="closet-progress" style="position:absolute; top:50%;left:50%; margin-left:-100px; margin-top:-5px;">\
        //             <span class="progressGif"></span>\
        //             <span class="progressNumber">0%</span></div>');
        //
        // var $progressGif = $('.closet-progress').find('.progressGif');
        // var $progressNumber = $('.closet-progress').find('.progressNumber');

        if(url === ''){
            return
        }

        var progress = function (xhr) {
            if (xhr.lengthComputable) {
                var percentComplete = xhr.loaded / xhr.total * 100;
                var percent = Math.round(percentComplete, 2);
                //console.log(Math.round(percentComplete, 2) + '% downloaded');

                if(onProgress) onProgress(percent)
                // var percentValue = Math.round(percentComplete, 2) + "%";
                // $progressGif.css({ width: percentValue });
                // $progressNumber.html(percentValue);
            }
        };

        var error = function (xhr) { };


        this.zrest = new ZRestLoader({ scene: this.scene, camera: this.camera, controls: this.controls, cameraPosition: this.cameraPosition });
        this.zrest.load(url, (object) => {
            console.log('------------------ loaded object', object)
            // progress-bar remove
            // $el.find('.closet-progress').animate({
            //     opacity: 0.5,
            // }, 1500, function () {
            //     $el.find('.closet-progress').remove();
            // });

            // loading 이 실제로 마무리되는 곳은 ZRestLoader 의 file reader 쪽에서이므로 scene 에 추가하는 것은 그쪽으로 변경한다. 이곳에서는 실제로 scene 에 object 가 add 되긴 하지만 로딩이 끝나기 전 빈 Object3D 만 추가된다.

            // if(this.object3D){
            //
            //
            // }
            // var selectedObject = this.scene.getObjectByName('object3D');
            // console.log('selectedObject', selectedObject)
            //
            if(this.object3D) this.scene.remove( this.object3D )
            this.scene.add(object)
            this.object3D = object

            if(onLoad) onLoad(this)

            // this.setCameraMatrix(cameraMatrix, false);
            this.changeColorway(colorwayIndex);

        }, progress, error);
    }

    getColorwaySize() {
        return this.zrest.colorwaySize
    }

    changeColorway(number) {

        if(number === undefined)
            return;

        if (this.zrest.colorwaySize - 1 < number) {
            console.log("index is over colorway size");
            return;
        }

        if (this.zrest.currentColorwayIndex === number) {
            console.log("index is same current index");
            return;
        }

        if (this.zrest.jsZip === undefined || this.zrest.jsZip === null) {
            console.log("zip is null");
            return;
        }
        this.zrest.currentColorwayIndex = number;

        // const matMeshList = this.zrest.matMeshList

        // const matMeshList = Global._globalMatMeshInformationList
        const matMeshList = this.zrest.matMeshList

        for (var i = 0 ; i < matMeshList.length ; ++i) {
            var prevMaterial = matMeshList[i].material;
            let preUseSeamPuckeringMap = false;
            if (prevMaterial.uniforms.bUseSeamPuckeringNormal !== undefined)
                preUseSeamPuckeringMap = prevMaterial.uniforms.bUseSeamPuckeringNormal.value;

            this.SafeDeallocation(prevMaterial, THREE.ShaderMaterial, function () {/*console.log("success deallocation");*/ }, function () {/*console.log("unsuccess deallocation");*/ });

            var id = matMeshList[i].userData;
            matMeshList[i].material = this.zrest.makeMaterialForZrest(this.zrest.jsZip, this.zrest.materialInformationMap.get(id), number, preUseSeamPuckeringMap, this.zrest.gVersion);
        }
    }


    SafeDeallocation(object, type, type_cb, nontype_cb){
        if(object instanceof type){type_cb(object);}
        else{nontype_cb(object);}
    }
}
