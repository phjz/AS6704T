/*
ASUSTOR AS6704T Fan & Display control
Use with ser2net configured use /dev/ttyS1 at port 2000 !!!!
Created by: phj@phj.hu
*/
const diskspace = require('diskspace');
const os = require("os");
const cpustat=require("cpu-stat");
const fs = require('fs');
const net=require("net");
var coms=null;

function prettydate(d) {
  var ts_hms = new Date(d.getTime();
  var ms = (ts_hms.getTime() % 1000);
  return ("00" + (ts_hms.getFullYear())).slice(-4) + '.' + ("0" + (ts_hms.getMonth() + 1)).slice(-2) + '.' + ("0" + (ts_hms.getDate())).slice(-2) + ' ' +
    ("0" + ts_hms.getHours()).slice(-2) + ':' + ("0" + ts_hms.getMinutes()).slice(-2) + ':' + ("0" + ts_hms.getSeconds()).slice(-2) + "." + (ms < 100 ? '0' + ms : ms);
}
function consolelog(x) {
  console.log(prettydate(new Date()) + " " + x);
}

function communicate() {
 coms=net.createConnection(2000,'127.0.0.1');
 coms.on('connect', function(err) {
  var b=Buffer.alloc(5);
  consolelog(" init:"+(err?err:"OK"));
  coms.setKeepAlive( true, 10000);
  //0x f0 01 13 01 05
  b[0]=0xf0; b[1]=0x01; b[2]=0x13; b[3]=0x01; b[4]=0x06;
  coms.write(b);
  setTimeout(setLine,1000,0,0,"AS6407T linuxgw ");
  setTimeout(setLine,1001,1,0,"... running ... ");
 });
 coms.on('data', function(buff) {
//  consolelog("data["+buff.length+"] "+buff.slice(0, buff.length).toString('hex')+"\n"+buff.toString());
  if (buff[0]==0xf0 && buff[1]==0x01 && buff[2]==0x80) {
   switch(buff[3]) {
   case 0x01: // button 1: UP
    cyc--; lcdcotrol();
    break; 
   case 0x02: // button2: DOWN
    cyc++; lcdcotrol();
    break; 
   case 0x03: // button3: BACK
    cyc=0; lcdcontrol();
    break; 
   case 0x04: // BUTTON4: ENTER
    lcdcontrol();
    break; 
   }
  }
 });
 coms.on('drain', function() { consolelog('drain'); });
 coms.on('error', function(err) { consolelog(" error event:"+err.toString()); });
 coms.on('timeout', function() { consolelog(" timeout,closing..:"); });
 coms.on('end', function() { consolelog(" end event"); });
 coms.on('close', function(err) { consolelog(" close event"); setTimeout(communicate,30000); coms=null; });
}

function checksum(b,sum) {
 for (var i=0;i<b.length-1;i++) sum+=b[i];
// consolelog("checksum["+b.length+"]:"+sum.toString(16)); 
 return(sum&0xff);
}
function setLine(line, indent, msg) {
 var s=Buffer.from(msg);
 if (s.lenght>16) { consolelog("message size too long:"+s.length); return; }
 // consolelog("send:"+s.slice(0, s.length).toString('hex')); 
 var b=Buffer.alloc(0x12+4);
 b.fill(0x20);
 s.copy(b,5);
 b[0]=0xf0;
 b[1]=0x12;
 b[2]=0x27;
 b[3]=line;
 b[4]=indent;
 b[b.length-1]=checksum(b,0);
 // consolelog("sent:"+b.slice(0, b.length).toString('hex')); 
 if (coms) coms.write(b);
}
// f0 12 00 11 22 33 44 55 66 77 88 99 aa bb cc dd ee ff
// f0 12 27 00 00 31 32 33 34 35 36 37 38 39 30 31 32 33 34 35 36 6b

var cpus;

var cyc=0;
var busy,totalx,cpuspeed,idle,cputotal=0,cpuidle=0;
var d1,d2,i,d,h,m,fan,dt,ct,et,pwm,stop;

function fancontrol() {
  ct=fs.readFileSync("/sys/class/hwmon/hwmon4/temp1_input");
  pwm=parseInt(fs.readFileSync("/sys/class/hwmon/hwmon3/pwm1"));
  i=(ct-60000)/(110000-60000)*(255-21)-58;//+31;
  if (i<13) i=13;
  else if (i>255) i=255;
  else i=parseInt(i);
  i=parseInt((pwm*3+i)/4);
  if (pwm!=i) {
   fan=parseInt(fs.readFileSync("/sys/class/hwmon/hwmon3/fan1_input"));
   fs.writeFileSync("/sys/class/hwmon/hwmon3/pwm1",""+i);
   consolelog("fan="+fan+" t="+(ct/1000).toFixed(2)+" -> pwm:"+i);
   stop=0
  } else if(!stop) {
   fan=parseInt(fs.readFileSync("/sys/class/hwmon/hwmon3/fan1_input"));
   consolelog("fan="+fan+" t="+(ct/1000).toFixed(2)+" == pwm:"+pwm);
   stop=1;
  }
}
function lcdcontrol() {
 switch(cyc) {
 case 0:
  i = os.uptime();
  d = h = m = 0;
  if (i > 3600 * 24) { d = parseInt(i / (3600 * 24)); i -= d * 3600 * 24; }
  if (i > 3600) { h = parseInt(i / 3600); i -= h * 3600; }
  if (i > 60) { m = parseInt(i / 60); i -= m * 60; }
  setLine(0,0,"AS6704T Linuxgw");
  setLine(1,0,"UP: " + d + "d " + h + "h " + m + "m");
  break;
 case 1:
  cpustat.usagePercent(function(err,percent,seconds) {
   setLine(0,0,"CPU: "+cpustat.totalCores()+", "+percent.toFixed(3)+" %");
  });
  setLine(1,0,"Speed: "+(cpustat.avgClockMHz()/1024).toFixed(3)+" GHz");
  break;
 case 2:
  diskspace.check('/', function (err, total, free, status) {
   d1=free
   diskspace.check('/big', function (err, total, free, status) {
    d2 = free;
    setLine(0,0,"DSK: "+(d1/1024/1024/1024).toFixed(0)+"/"+(d2/1024/1024/1024).toFixed(0)+" G");
    setLine(1,0,"Free: "+(os.freemem()/1024/1024).toFixed(2)+" M ");
   });
  });
  break;
 case 3:
  busy=os.loadavg()
  setLine(1,0,"AVG:"+busy[0].toFixed(1)+" "+busy[1].toFixed(1)+" "+busy[2].toFixed(1));

  break;
 case 4:
  fan=fs.readFileSync("/sys/class/hwmon/hwmon3/fan1_input");
  et=fs.readFileSync("/sys/class/hwmon/hwmon0/temp1_input");
  dt=fs.readFileSync("/sys/class/hwmon/hwmon1/temp1_input");
  setLine(0,0,"FAN: "+parseInt(fan)+"  "+(et/1000).toFixed(2)+"C");
  setLine(1,0,"CPU: "+(ct/1000).toFixed(0)+" DSK: "+(dt/1000).toFixed(0)+"C");
  break;
 default:
  cyc=-1;
  break;
 }
 cyc++;
}

function worker() {
 fancontrol();
 lcdcontrol();
}
communicate();
setInterval(worker,10000);

///////////////////////////////////////////////////////////////////////////////////////////////////////////
process.on('uncaughtException', function (err) {
  consolelog('uncaughtException' + err + '\n' + err.stack);
});

process.on('exit', function (code) {
  fs.writeFileSync("/root/node/ditu", JSON.stringify(ditusz));
  consolelog('About to exit with code:', code);
});
