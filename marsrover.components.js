class Coordinate
{
  constructor(x,y) {
    this.x = Number(x) || 0;
    this.y = Number(y) || 0;
    Object.freeze(this); //force read-only
  }

  at(degrees,distance) {
    const rad = (Math.PI / 180.0) * (degrees % 360);
    const dx = distance * Math.sin(rad);
    const dy = distance * Math.cos(rad);
    const x = (this.x + dx).toFixed(4);
    const y = (this.y + dy).toFixed(4);
    return new Coordinate(x,y);
  }

  toString() { return `${this.x}, ${this.y}`; }
}

document.registerElement("mars-plateau", class extends HTMLElement
{  
  createdCallback() {
    this.attributeChangedCallback(); // make sure attributes are initialized
    document.addEventListener("keydown", e => this._keyPressed(e.keyCode));
  }

  attributeChangedCallback() {
    this.style.width = `${(this.size.x + 1) * this.scale}px`;
    this.style.height = `${(this.size.y + 1) * this.scale}px`;
  }

  _keyPressed(keyCode) {
    if (keyCode == 78) { this.createRover(0,0,"N"); return; } //N
    const action = (() => {
      switch (keyCode) {
        case 76: return r => r.turnLeft(); //L
        case 77: return r => r.move(); //M
        case 82: return r => r.turnRight(); //R
        default: return null;
      }
    })();
    if (!action) return;
    const rovers = this.rovers;
    const activeRover = rovers[rovers.length-1];
    if (!activeRover) return;
    action(activeRover);
  }

  get rovers() { return Array.from(this.getElementsByTagName("mars-rover")); }

  get scale() { return Number(this.dataset.scale) || 50; }

  get size() { return new Coordinate(this.dataset.xSize, this.dataset.ySize); }

  set size(size) { 
    this.dataset.xSize = size.x;
    this.dataset.ySize = size.y;
  }

  createRover(x,y,heading) {
    const rover = document.createElement("mars-rover");
    rover.dataset.x = x;
    rover.dataset.y = y;
    rover.dataset.heading = (heading => {
      switch (heading.toUpperCase()) {
        case "N": return 0;
        case "E": return 90;
        case "S": return 180;
        case "W": return 270;
        default: throw new Error("Unrecognized direction. Use [NESW]");
      }
    })(heading||"");
    this.appendChild(rover);
    return rover;
  }

  parseRover(positionString) {
    const regex = /(\d+) (\d+) ([NESW])/i;
    if (!regex.test(positionString)) throw new Error(`Unable to read rover positon ${positionString}. Format is "X Y [NESW]".`)
    const [,x,y,heading] = regex.exec(positionString);
    return this.createRover(x,y,heading);
  }

  parseRoverCommandSet(position, commands) {
    return this.parseRover(position)
      .processCommands(commands)
      .catch(err => console.error(err));
  }

  execute(string) {
    const lines = string.split(/\n/g);
    const plateauSizeRegex = /(\d+) (\d+)/;
    const [plateauSize, ...roverCommands] = lines;
    const [,x,y] = plateauSizeRegex.exec(plateauSize);
    this.size = new Coordinate(x,y);
    const actions = [];
    for (var i = 0; i < roverCommands.length; i+=2) {
      const position = roverCommands[i], commands = roverCommands[i+1];
      actions.push(this.parseRoverCommandSet(position,commands));
    }
    return Promise.all(actions).then(() => this.rovers);
  }

  clear() {
    while(this.firstChild) {
      this.removeChild(this.firstChild);
    }
  }
});

document.registerElement("mars-rover", class extends HTMLElement 
{
  constructor() {
    super();
    this._isMoving = false;
  }

  get heading() { return Number(this.dataset.heading||0); }
  set heading(degrees) { this.dataset.heading=degrees; }

  get position() { return new Coordinate(this.dataset.x,this.dataset.y); }
  set position(coordinate) {
    const {x,y} = coordinate;
    this.dataset.x = x;
    this.dataset.y = y;
  }

  get crashed() { return Boolean(this.dataset.crashed); }

  get plateau() { return this.parentElement; }

  attributeChangedCallback() {
    const { x, y, heading } = this.dataset;
    const { size, scale } = this.plateau;
    if (!this.crashed && (x > size.x || y > size.y )) {
      this.dataset.crashed = true;
    }
    this.style.transform = `rotate(${heading||0}deg)`;
    this.style.bottom = `${(y||0)*scale}px`;
    this.style.left = `${(x||0)*scale}px`;
  }

  toString() { 
    const {x,y} = this.position;
    let cardinalDirection = (heading => {
      switch (Math.abs(heading % 360)) {
        case 0: return "N";
        case 90: return "E";
        case 180: return "S";
        case 270: return "W";
        default: return heading;
      }
    })(this.heading||0);
    return this.crashed ? 
      `Crashed at ${x} ${y} ${cardinalDirection}` :
      `${x} ${y} ${cardinalDirection}`;
  }

  turnLeft() { return this.turn(-90); }
  turnRight() { return this.turn(90); }

  move() {
    if (this._isMoving) return;
    this._isMoving = true;
    if (this.crashed) throw new Error("Rover is crashed. Cannot move");
    console.debug(`Moving forward.`);
    const initialPosition = this.position;
    const heading = this.heading;
    return this._animate(progress => this.position = initialPosition.at(heading, progress))
      .then(() => this._isMoving = false);
  }

  turn(degrees)
  {
    if (this._isMoving) return;
    this._isMoving = true;
    if (this.crashed) throw new Error("Rover is crashed. Cannot move");
    console.debug(`Turning ${degrees}deg.`);
    const initialHeading = this.heading;
    return this._animate(progress => this.heading = initialHeading + (degrees*progress))
      .then(() => this._isMoving = false);
  }

  _animate(onNext) {
    const duration = Number(this.plateau.dataset.animationDuration) || 500;
    return new Promise((resolve,reject) => {
      let start = null;
      const next = time => {
        if (!start) start = time;
        const progress = (time - start) / duration;
        if (progress < 1.0) { 
          onNext(progress);
          requestAnimationFrame(next);
        } else {
          onNext(1.0);
          resolve();
        };
      }
      requestAnimationFrame(next);
    });
  }

  processCommands(commands) {
    const [first, ...rest] = commands;
    if (!first) return Promise.resolve(this); // nothing to do
    return this.processCommand(first)
      .then(() => rest.length > 0 ? this.processCommands(rest) :  Promise.resolve(this));
  }

  processCommand(command) {
    switch ((command||"").toUpperCase()) {
      case 'L': return this.turnLeft();
      case 'R': return this.turnRight();
      case 'M': return this.move();
      default: return Promise.resolve(); // NoOp
    }
  }
});