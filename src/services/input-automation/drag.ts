// A press-hold-release drag (1118-1 p2: Steamworks' Graphical Assets take images only dropped from Explorer). OLE drag and drop starts only once the
// pointer moves past the drag threshold with the button down (SM_CXDRAG, 4 px at 100 %), and a page's drop zone sees the file only after it has had
// pointer moves over it: so the path leaves `from` in a small first step, crosses in steps with a pause each, and hovers over `to` before the release.

/** The mouse as drag uses it: points are the caller's, already scaled. */
export interface DragMouse {
    moveTo(x: number, y: number): Promise<unknown>
    press(): Promise<unknown>
    release(): Promise<unknown>
    pause(ms: number): Promise<unknown>
}

export const DragSteps = 20, DragStepMs = 25, DragHoldMs = 300

/** The points the pointer passes with the button down: a first 8 px toward `to` (past the threshold), the line in `steps` even steps, then two 2 px
 *  hover moves over `to` and `to` itself. A drag shorter than 8 px still ends on `to`. */
export function dragPath(fromX: number, fromY: number, toX: number, toY: number, steps = DragSteps): Array<[number, number]> {
    const dx = toX - fromX, dy = toY - fromY, length = Math.hypot(dx, dy)
    const points: Array<[number, number]> = []
    if (length > 8) points.push([Math.round(fromX + dx / length * 8), Math.round(fromY + dy / length * 8)])
    for (let i = 1; i <= steps; i++) points.push([Math.round(fromX + dx * i / steps), Math.round(fromY + dy * i / steps)])
    points.push([toX + 2, toY], [toX, toY + 2], [toX, toY])
    return points
}

/** Moves to `from`, presses, follows dragPath with a pause each step, holds over `to`, releases. The button is released on any error. */
export async function drag(mouse: DragMouse, fromX: number, fromY: number, toX: number, toY: number, steps = DragSteps): Promise<void> {
    await mouse.moveTo(fromX, fromY)
    await mouse.pause(DragStepMs)
    await mouse.press()
    try {
        for (const [x, y] of dragPath(fromX, fromY, toX, toY, steps)) {
            await mouse.moveTo(x, y)
            await mouse.pause(DragStepMs)
        }
        await mouse.pause(DragHoldMs)
    } finally {
        await mouse.release()
    }
}
