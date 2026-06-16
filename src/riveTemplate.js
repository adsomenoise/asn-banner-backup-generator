export function parseRivDimensions(fileName) {
  const match = fileName.match(/(\d+)x(\d+)/);
  if (!match) return null;
  const w = parseInt(match[1], 10);
  const h = parseInt(match[2], 10);
  if (w > 0 && h > 0 && w < 10000 && h < 10000) return { width: w, height: h };
  return null;
}

function escapeHTML(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeJSString(str) {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

export function generateRiveHTML(jsFileName, width, height) {
  const title = escapeHTML(jsFileName.replace(/\.js$/i, ''));
  const jsSrc = escapeJSString(jsFileName);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <meta name="ad.size" content="width=${width},height=${height}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />

  <script type="text/javascript">
    !function(){var a="",i=function(i){try{var n=JSON.parse(i.data)}catch(e){return}if(n.isInitClickTag){if(n.clickTags)for(var c=0;c<n.clickTags.length;c++){var t=n.clickTags[c];window[t.name]=t.url}else n.clickTag&&(window.clickTag=n.clickTag);a=n.relegateNavigation}};open.call&&(window.open=function(i){return function(n,e,c){if("parent"===a){var t={clickTag:n,isPostClickTag:!0};parent.postMessage(JSON.stringify(t),"*")}else{var o=[n,e];c&&o.push(c),i.apply(window,o)}}}(window.open)),window.addEventListener?window.addEventListener("message",i,!1):window.attachEvent("onmessage",i)}();
      var clickTag=''; 
  </script>

  <script src="https://s0.2mdn.net/creatives/assets/5617025/rive.js"></script>

  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background-color: transparent;
    }

    #ad {
      position: relative;
      width: 100%;
      height: 100%;
      cursor: pointer;
    }

    #rive-canvas {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      z-index: 1;
      display: block;
    }

    #border-overlay {
      position: absolute;
      inset: 0;
      box-sizing: border-box;
      border: 1px solid #cccccc;
      z-index: 10;
      pointer-events: none;
    }
  </style>
</head>

<body>
  <a href="javascript:window.open(window.clickTag)">
    <div id="ad">
        <canvas id="rive-canvas"></canvas>
        <div id="border-overlay"></div>
    </div>
  </a>

  <script>
    (function () {
      var ad = document.getElementById("ad");
      var canvas = document.getElementById("rive-canvas");

      function getBannerSize() {
        var width = ad.offsetWidth;
        var height = ad.offsetHeight;

        if (!width || !height) {
          width = ${width};
          height = ${height};
        }

        return {
          width: width,
          height: height
        };
      }

      function setupCanvas() {
        var size = getBannerSize();
        var dpr = window.devicePixelRatio || 1;

        canvas.width = size.width * dpr;
        canvas.height = size.height * dpr;
        canvas.style.width = size.width + "px";
        canvas.style.height = size.height + "px";
      }

      setupCanvas();

      var riveInstance = new rive.Rive({
        src: '${jsSrc}',
        canvas: canvas,
        stateMachines: "State Machine 1",
        autoplay: true,
        onLoad: function () {
          riveInstance.resizeDrawingSurfaceToCanvas();
        }
      });

      window.addEventListener("resize", function () {
        setupCanvas();
        if (riveInstance && riveInstance.resizeDrawingSurfaceToCanvas) {
          riveInstance.resizeDrawingSurfaceToCanvas();
        }
      });
    })();
  </script>
</body>
</html>`;
}
