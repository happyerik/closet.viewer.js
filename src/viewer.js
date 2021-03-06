﻿import ZRestLoader, { dataWorkerFunction, checkFileReaderSyncSupport } from './lib/clo/readers/ZrestReader'
import * as THREE from '@/lib/threejs/three'
import '@/lib/threejs/OrbitControls'
import '@/lib/draco/DRACOLoader'
//import '@/lib/clo/UtilFunctions'
import RendererStats from '@xailabs/three-renderer-stats';
import {TweenMax } from "gsap/TweenMax";
import AnnotationManager from "@/lib/annotation/AnnotationManager"

var container, states;
var camera, scene, renderer, controls;
var background_camera, background_scene;
var windowHalfX = window.innerWidth / 2;
var windowHalfY = window.innerHeight / 2;

var reader;
var progress = document.querySelector('.percent');
var dataSyncWorkerURL = URL.createObjectURL(new Blob(["(" + dataWorkerFunction.toString() + ")()"], { type: 'text/javascript' }));
var timerId = 0;
let rendererStats = null

checkFileReaderSyncSupport();

var cameraHeight = 1100;
var cameraDistance = 5000;

var envDiffuseMap = null;
var envSpecularMap = null;

var intProgress = 0;

// var setter = null

let requestId = null

if(!PRODUCTION) rendererStats = new RendererStats();



var mouse = new THREE.Vector2(), INTERSECTED;

var helper;








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
    this.onMouseClick = this.onMouseClick.bind(this)
    this.onDocumentMouseMove = this.onDocumentMouseMove.bind(this)
    this.setVisibleAllGarment = this.setVisibleAllGarment.bind(this)
    this.setVisibleAllAvatar = this.setVisibleAllAvatar.bind(this)
    this.isExistGarment = this.isExistGarment.bind(this)
    this.isExistAvatar = this.isExistAvatar.bind(this)
    this.GetGarmentShowHideStatus = this.GetGarmentShowHideStatus.bind(this)
    this.GetAvatarShowHideStatus = this.GetAvatarShowHideStatus.bind(this)
    this.isAvailableShowHide = this.isAvailableShowHide.bind(this)
    this.setCameraPosition = this.setCameraPosition.bind(this)
    this.updateRender = this.updateRender.bind(this)
    this.loadZrestData = this.loadZrestData.bind(this)

    this.object3D = null
    //this.annotationPointerGroup = new THREE.Object3D();

  }

  init({ width, height, element, cameraPosition = null }) {

    var w = width;
    var h = height;
    this.setter = element;
    this.id = element;
    this.cameraPosition = cameraPosition;

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
    //this.camera.position.y = cameraHeight;
    //this.camera.position.z = cameraDistance;
    this.camera.position.set(0, cameraHeight, cameraDistance);

    //create camera controller
    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target = new THREE.Vector3(0, cameraHeight, 0);
    this.controls.update();
    this.controls.addEventListener('change', () => {
      if(this.updateCamera) this.updateCamera({ target: this.controls.target, position: this.camera.position, id: this.id })
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

    //var sprite = makeTextSprite( "2", 
	//	{ fontsize: 32, fontface: "Georgia", borderColor: {r:0, g:0, b:255, a:1.0} } );
    //sprite.position.set(0,0,0);
    //this.scene.add( sprite );

    //
    //var geometry = new THREE.BoxBufferGeometry( 20, 20, 20 );
    //var material = new THREE.MeshBasicMaterial( {color: 0x00ff00} );
    //var cube = new THREE.Mesh( geometry, material );
    //this.scene.add( cube );

    // sphere
    //var sphereGeometry = new THREE.SphereBufferGeometry(50, 32, 32);
    //var sphereMaterial = new THREE.MeshBasicMaterial({color: 0xff0000});
    //var sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
    //this.scene.add(sphere);

    //var geometryCone = new THREE.ConeBufferGeometry( 20, 100, 3 );
    //geometryCone.translate( 0, 50, 0 );
    //geometryCone.rotateX( Math.PI / 2 );
    //helper = new THREE.Mesh( geometryCone, new THREE.MeshNormalMaterial() );
    //this.scene.add( helper );
    //helper.visible = false;

    // floor
    /*var planeGeometry = new THREE.PlaneBufferGeometry(10000, 10000, 2, 2);
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
    canvas.addEventListener("click", this.onMouseClick, false);
    //canvas.addEventListener('mousemove', this.onDocumentMouseMove, false);

    if(!PRODUCTION){
      rendererStats.domElement.style.position	= 'absolute'
      rendererStats.domElement.style.left	= '-100px'
      rendererStats.domElement.style.top	= '0px'
      document.getElementById(this.setter).appendChild( rendererStats.domElement )
    }



    //raycaster.params.Points.threshold = threshold;

      //this.scene.add(this.annotationPointerList);


    //this.animate()

    // this.render()
    this.updateRender(1)
  }

  onDocumentMouseMove( e )
  {
      e.preventDefault();
      return;
      //
      // test code


    var from = {
        x: 0,
        y: 0,
        z: 10000
    };

    var to = {
        x: 0,
        y: 0,
        z: 1000
    };

    var self = this;

    return;
    var tween = new TWEEN.Tween(from)
        .to(to, 1000)
        .easing(TWEEN.Easing.Linear.None)
        .onUpdate(function () {
            self.camera.position.set(this.x, this.y, this.z);
            self.camera.lookAt(new THREE.Vector3(0, cameraHeight, 0));
            self.updateRender();
        })
        .onComplete(function () {
            self.controls.target.copy(self.scene.position);
            //self.controls.target.copy(self.scene.position);
            //self.camera.lookAt(new THREE.Vector3(0, cameraHeight, 0));
        })
        .start();

    return;
    

    //1. sets the mouse position with a coordinate system where the center
    //   of the screen is the origin
    // canvas full screen
    //mouse.x = ( e.clientX / window.innerWidth ) * 2 - 1;
    //mouse.y = - ( e.clientY / window.innerHeight ) * 2 + 1;

    let canvasBounds = this.renderer.context.canvas.getBoundingClientRect();
    mouse.x = ( ( e.clientX - canvasBounds.left ) / ( canvasBounds.right - canvasBounds.left ) ) * 2 - 1;
    mouse.y = - ( ( e.clientY - canvasBounds.top ) / ( canvasBounds.bottom - canvasBounds.top) ) * 2 + 1;


    //2. set the picking ray from the camera position and mouse coordinates
    raycaster.setFromCamera(mouse, this.camera);

    //console.log(this.object3D);
    //3. compute intersections
    if (this.zrest.matMeshList !== undefined)
    {
      var intersects = raycaster.intersectObjects(this.zrest.matMeshList, true);
      if(intersects.length > 0)
      {
        helper.position.set(0, 0, 0);
        helper.lookAt(intersects[0].face.normal);
        helper.position.copy(intersects[0].point);
      }
    }

    /*
    if ( intersects.length > 0 )
    {

        //if ( INTERSECTED != intersects[ 0 ].object )
        {
            if ( INTERSECTED )
            {
                //INTERSECTED.material.emissive.setHex( INTERSECTED.currentHex );
                //INTERSECTED.material.color.setHex( INTERSECTED.currentHex );
            }

            INTERSECTED = intersects[ 0 ].object;
            //INTERSECTED.currentHex = INTERSECTED.material.color.getHex();
            //INTERSECTED.material.color.setHex( 0xff0000 );
            //INTERSECTED.currentHex = INTERSECTED.material.emissive.getHex();
            //INTERSECTED.material.emissive.setHex( 0xff0000 );

            sphere.position.set(0,0,0);
            sphere.lookAt(intersects[0].face.normal);
            sphere.position.copy(intersects[0].point);

            console.log(intersects[ 0 ].point);

        }
    }
    else
    {
        if ( INTERSECTED )
        {
            //INTERSECTED.material.emissive.setHex( INTERSECTED.currentHex );
            //INTERSECTED.material.color.setHex( INTERSECTED.currentHex );
        }

        INTERSECTED = null;
    }
    */


    //console.log(this.object3D);
    //for ( var i = 0; i < intersects.length; i++ )
    //{
    //    console.log( intersects[ i ] );
    /*
        An intersection has the following properties :
            - object : intersected object (THREE.Mesh)
            - distance : distance from camera to intersection (number)
            - face : intersected face (THREE.Face3)
            - faceIndex : intersected face index (number)
            - point : intersection point (THREE.Vector3)
            - uv : intersection point in the object's UV coordinates (THREE.Vector2)
    */
    //}
  }





  onMouseClick( e )
  {
    console.log(e)
    e.preventDefault();
    if(this.annotation) this.annotation.onMouseClick(e)
  }

  setVisibleAllGarment(visibility)
  {
    for(var i=0; i<this.zrest.matMeshList.length; i++)
    {
      if(this.zrest.matMeshList[i].userData.TYPE == this.zrest.MatMeshType.PATTERN_MATMESH ||
        this.zrest.matMeshList[i].userData.TYPE == this.zrest.MatMeshType.TRIM_MATMESH ||
        this.zrest.matMeshList[i].userData.TYPE == this.zrest.MatMeshType.PRINTOVERLAY_MATMESH ||
        this.zrest.matMeshList[i].userData.TYPE == this.zrest.MatMeshType.BUTTONHEAD_MATMESH ||
        this.zrest.matMeshList[i].userData.TYPE == this.zrest.MatMeshType.STITCH_MATMESH )
      {
        this.zrest.matMeshList[i].visible = visibility;
      }
    }
    
    this.updateRender();
  }

  isExistGarment()
  {
    for(var i=0; i<this.zrest.matMeshList.length; i++)
    {
      if(this.zrest.matMeshList[i].userData.TYPE == this.zrest.MatMeshType.PATTERN_MATMESH)
      {
        return true;
      }
    }

    return false;
  }

  setVisibleAllAvatar(visibility)
  {
    for(var i=0; i<this.zrest.matMeshList.length; i++)
    {
      if(this.zrest.matMeshList[i].userData.TYPE == this.zrest.MatMeshType.AVATAR_MATMESH)
      {
        this.zrest.matMeshList[i].visible = visibility;
      }
    }
    
    this.updateRender();
  }

  isExistAvatar()
  {
    for(var i=0; i<this.zrest.matMeshList.length; i++)
    {
      if(this.zrest.matMeshList[i].userData.TYPE == this.zrest.MatMeshType.AVATAR_MATMESH)
      {
        return true;
      }
    }

    return false;
  }

  GetGarmentShowHideStatus()
  {
    for(var i=0; i<this.zrest.matMeshList.length; i++)
    {
      if(this.zrest.matMeshList[i].userData.TYPE == this.zrest.MatMeshType.PATTERN_MATMESH)
      {
        if(this.zrest.matMeshList[i].visible === true)
          return true;
      }
    }

    return false;
  }

  GetAvatarShowHideStatus()
  {
    for(var i=0; i<this.zrest.matMeshList.length; i++)
    {
      if(this.zrest.matMeshList[i].userData.TYPE == this.zrest.MatMeshType.AVATAR_MATMESH)
      {
        if(this.zrest.matMeshList[i].visible === true)
          return true;
      }
    }

    return false;
  }

  isAvailableShowHide()
  {
    if (this.zrest.gVersion >= 4)
      return true;
    else
      return false;
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
        this.updateRender()
    }
  }

  setWindowSize(w, h) {

    windowHalfX = w / 2;
    windowHalfY = h / 2;

    this.renderer.setSize(w, h);

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);

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
    //console.log("camera position: " + this.camera.position);
    this.controls.update();
    this.render();
  }

  render() {
    
    if(this.annotation) this.annotation.updateAnnotationPointerSize() // update annotation pointer size
    //
    this.renderer.autoClear = false;
    this.renderer.clear();

    this.renderer.render(this.background_scene, this.background_camera); // draw background
    this.renderer.render(this.scene, this.camera); // draw object
    if(!PRODUCTION) rendererStats.update(this.renderer);
  }

  updateRender(t = 100, isUpdate = false){
    // 여기에 pointer 업데이트 하는 함수 콜하기.
    this.controls.update()
    setTimeout(this.render, t)
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

  loadZrestUrl(url, onProgress, onLoad, colorwayIndex) {
    if(!url) return
    this.loadZrestUrlWithParameters(url, onProgress, onLoad, colorwayIndex);
  }

  loadZrestData(data, onLoad, colorwayIndex) {
    if(!data) return
    this.loadZrestUrlWithParameters(data, null, onLoad, colorwayIndex);
  }

  loadZrestUrlWithParameters(url, onProgress, onLoad, colorwayIndex) {
    const progress = function (xhr) {
      if (xhr.lengthComputable) {
        const percentComplete = xhr.loaded / xhr.total * 100;
        const percent = Math.round(percentComplete, 2);
        if(onProgress) onProgress(percent)
      }
    };

    const error = function (xhr) { };

    const loaded = async (object, loadedCamera, data) => {

      this.annotation = new AnnotationManager({
        scene: this.scene,
        camera: this.camera,
        renderer: this.renderer,
        controls: this.controls,
        zrest: this.zrest,
        updateRender: this.updateRender
      })

      // delete object3D, geometry, material dispose
      for (var i = 0 ; i < this.scene.children.length; i++) {
        if(this.scene.children[i].name === 'object3D') {
          clearThree(this.scene.children[i])
        }
      }
      if(colorwayIndex > -1) await this.changeColorway(colorwayIndex);
      this.scene.add(object)
      this.object3D = object
      this.zrest.ZoomToObjects(loadedCamera, this.scene);


      if(onLoad) onLoad(this)


      this.updateRender()

    }

    if(url.constructor === ArrayBuffer){
      this.zrest = new ZRestLoader({ scene: this.scene, camera: this.camera, controls: this.controls, cameraPosition: this.cameraPosition });
      this.zrest.parse(url, loaded);
      return
    }


    if(url.constructor === String){
      this.zrest = new ZRestLoader({ scene: this.scene, camera: this.camera, controls: this.controls, cameraPosition: this.cameraPosition });
      this.zrest.load(url, loaded, progress, error);
    }




  }

  setCameraPosition(position, target) {
    this.camera.position.copy(position)
    if(target) this.controls.target.copy(target)
    this.updateRender()
  }

  getColorwaySize() {
    return this.zrest.colorwaySize
  }

  async changeColorway(number) {

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

      var id = matMeshList[i].userData.MATMESH_ID;
      matMeshList[i].material = await this.zrest.makeMaterialForZrest(this.zrest.jsZip, this.zrest.materialInformationMap.get(id), number, preUseSeamPuckeringMap, this.zrest.gVersion);
    }

    this.updateRender()
  }


  SafeDeallocation(object, type, type_cb, nontype_cb){
    if(object instanceof type){type_cb(object);}
    else{nontype_cb(object);}
  }
}
function clearThree(obj){
  while(obj.children.length > 0){
    clearThree(obj.children[0])
    obj.remove(obj.children[0]);
  }
  if(obj.geometry) obj.geometry.dispose()
  if(obj.material) obj.material.dispose()
  if(obj.texture) obj.texture.dispose()
}