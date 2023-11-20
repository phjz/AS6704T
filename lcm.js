#!/usr/bin/node
/*
ASUSTOR AS6704T Fan & Display control
Use with ser2net configured use /dev/ttyS1 at port 2000 !!!!
Created by: phj@phj.hu
*/
var i;
const diskspace = require('diskspace');
const os = require("os");
const cpustat=require("cpu-stat");
const fs = require('fs');
const net=require("net");
if (fs.existsSync("/sys/class/hwmon/hwmon4/pwm1")) i=4; else i=3;
const IT87_HW="/sys/class/hwmon/hwmon"+i+"/";
const NORMAL_HW="/sys/class/hwmon/hwmon"+(i==4?3:4)+"/";
var coms=null;
const PWM_MIN=21; //below that the fan stopped..
const PWM_MAX=90; //at higher value the fan became too noisy, moreover the NVME became too cold
//const fd_green=fs.open("/sys/class/leds/red:status/brightness");
//const fd_blink=fs.open(IT87_HW+"gpled1_blink_freq");
var pwm_fd,temp_fd,fan_fd;
fs.open(IT87_HW+"pwm1",'w', function(err,fd) { if(err) consolelog(err.toString()); else pwm_fd=fd; });
fs.open(NORMAL_HW+"temp1_input", function(err,fd) { if(err) consolelog(err.toString()); else temp_fd=fd; });
fs.open(IT87_HW+"fan1_input", function(err,fd) { if(err) consolelog(err.toString()); else fan_fd=fd; });

function prettydate(d) {
  var ts_hms = new Date(d.getTime());
  var ms = (ts_hms.getTime() % 1000);
  return ("00" + (ts_hms.getFullYear())).slice(-4) + '.' + ("0" + (ts_hms.getMonth() + 1)).slice(-2) + '.' + ("0" + (ts_hms.getDate())).slice(-2) + ' ' +
    ("0" + ts_hms.getHours()).slice(-2) + ':' + ("0" + ts_hms.getMinutes()).slice(-2) + ':' + ("0" + ts_hms.getSeconds()).slice(-2) + "." + (ms < 100 ? '0' + ms : ms);
}
function consolelog(x) {
  console.log(prettydate(new Date()) + " " + x);
}

function countline(str) {
 var ptr=str.indexOf('\n');
 var n=0;
 var len=str.length
 while (str.length) {
  n++;
  str=str.substr(ptr+1);
  ptr=str.indexOf('\n');
 }
 return n;
}

function communicate() {
 coms=net.createConnection(2000,'172.16.8.2'); //'127.0.0.1');
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
    cyc--; lcdcontrol();
    break; 
   case 0x02: // button2: DOWN
    cyc++; lcdcontrol();
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
var busy,totalx,cpuspeed,idle,cputotal=0,cpuidle=0,tempalarm=0,loadalarm=0;;
var d1,d2,i,d,h,m,fan,dt,ct,et,pwm,stop,stx;

fs.writeFileSync("/sys/class/leds/red:status/brightness","1");
fs.writeFileSync("/sys/class/leds/red:power/brightness","0"); 
fs.writeFileSync("/sys/class/hwmon/hwmon"+i+"/gpled1_blink_freq","11");
fs.writeFileSync("/sys/class/leds/red:status/brightness","1"); 

const fdopts={ position: 0 };

function get_temp() {
 var ctb=Buffer.alloc(6);
 fs.read(temp_fd,ctb,fdopts,function(err, n, buf) {
  if (err) consolelog(err.toString());
  else {
   ct = parseInt(buf.toString());
   }
  }); 
}
function get_fan() {
 var fab=Buffer.alloc(4);
 fs.read(fan_fd,fab,fdopts,function(err, n, buf) {
  if (err) consolelog(err.toString());
  else {
   fan = parseInt(buf.toString());
   }
  }); 
}
function set_pwm(val) {
 var pwb=""+val;
 fs.write(pwm_fd,pwb,0,'ascii',function(err,n,str) {
  if (err) consolelog("pwm:"+err.toString()+": "+pwb+"/"+str);
  }); 
}

pwm=parseInt(fs.readFileSync(IT87_HW+"pwm1"));
ct=fs.readFileSync(NORMAL_HW+"temp1_input");
fan=parseInt(fs.readFileSync(IT87_HW+"fan1_input"));
var avg=0;
busy=[0,0,0];

function fancontrol() {
  //ct=fs.readFileSync(NORMAL_HW+"temp1_input");
  if (isNaN(pwm)) return;
  get_temp();
  //pwm=parseInt(fs.readFileSync(IT87_HW+"pwm1"));
  if ( !tempalarm && (ct >= 88000)) {
   tempalarm = 1;
   fs.writeFileSync("/sys/class/leds/red:power/brightness","1"); 
  } else if ( tempalarm && (ct<87500)){
   tempalarm = 0;
   fs.writeFileSync("/sys/class/leds/red:power/brightness","0"); 
  }
  i=(ct-65000)/1000;                  //diff in Celsius to min
  i=i/35*PWM_MAX;                     //full range 65-100=35C, at 100C max PWM, linear 
  d=i;
  if (i > pwm) i=parseInt((pwm+i)/2); // quickly ramp up
  else i=parseInt((pwm*2+i)/3);       // slow down
  if (i < PWM_MIN) i=PWM_MIN;         // min/max pwm check
  else if (i > PWM_MAX) i=PWM_MAX;
  //fan=parseInt(fs.readFileSync(IT87_HW+"fan1_input"));
  stx=" ";
  if (busy[0].toFixed(1)!=avg.toFixed(1)) {
   stx="avg:"+busy[0].toFixed(2)+" ";
   avg = busy[0];
  } else stx=" ";
  if (pwm != i) {
   //fs.writeFileSync(IT87_HW+"pwm1",""+i);
   set_pwm(i);
   pwm = i;
   consolelog(stx+"fan="+fan+" t="+(ct/1000).toFixed(2)+" -> pwm:"+d.toFixed(1)+" / "+i);
   stop=0
  } else if(!stop || stx!=" ") {
   consolelog(stx+"fan="+fan+" t="+(ct/1000).toFixed(2)+" == pwm:"+d.toFixed(1)+" / "+i);
   stop=1;
  }
  get_fan();
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
  diskspace.check('/', function (err, res) {
   d1=res.free
   diskspace.check('/big', function (err, res2) {
    d2 = res2.free;
    setLine(0,0,"DSK: "+(d1/1024/1024/1024).toFixed(0)+"/"+(d2/1024/1024/1024).toFixed(0)+" G");
    setLine(1,0,"Free: "+(os.freemem()/1024/1024).toFixed(2)+" M ");
   });
  });
  break;
 case 3:
  busy=os.loadavg()
  setLine(1,0,"AVG:"+busy[0].toFixed(1)+" "+busy[1].toFixed(1)+" "+busy[2].toFixed(1));
  if ( !loadalarm && ( busy[0] >= 2)) {
   loadalarm = 1;
   fs.writeFileSync("/sys/class/leds/red:status/brightness","0");
   fs.writeFileSync(IT87_HW+"gpled1_blink_freq","2");
  } else if ( loadalarm && ( busy[0] < 1.95)){
   loadalarm = 0;
   fs.writeFileSync(IT87_HW+"gpled1_blink_freq","11");
   fs.writeFileSync("/sys/class/leds/red:status/brightness","1"); 
  }
  break;
 case 4:
  //fan=fs.readFileSync(IT87_HW+"fan1_input");
  et=fs.readFileSync("/sys/class/hwmon/hwmon0/temp1_input");
  dt=fs.readFileSync("/sys/class/hwmon/hwmon1/temp1_input");
  setLine(0,0,"FAN: "+parseInt(fan)+"  "+(et/1000).toFixed(2)+"C");
  setLine(1,0,"CPU: "+(ct/1000).toFixed(0)+" DSK: "+(dt/1000).toFixed(0)+"C");
  break;
 case 5:
  var s1="PROCESS:  " + countline(fs.readFileSync('/tmp/psax').toString());
  var s2="DHCP IP:   " + countline(fs.readFileSync('/tmp/leases').toString());
  setLine(0,0,s1);
  setLine(1,0,s2);
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
  consolelog('About to exit with code:', code);
});
